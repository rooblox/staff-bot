/**
 * roblox-api-server.js — Express HTTP server for Roblox ↔ Discord session bridge
 *
 * Runs alongside Discord.js in the same process.
 * The Roblox game polls GET /api/sessions/upcoming every 60s.
 * The game POSTs to /api/sessions/:id/status when host interacts with the in-game UI.
 *
 * SETUP IN index.js:
 *   const { startApiServer } = require('./commands/roblox-api-server');
 *   client.once('ready', () => { startApiServer(client); });
 */

const express = require('express');
const { Session, RobloxLink } = require('../db');

// DST-aware ET offset helper (duplicated here to avoid circular dep)
function getEasternOffsetHours(utcDate) {
    const year = utcDate.getUTCFullYear();
    function nthSun(y, mo, nth) {
        let count = 0;
        const d = new Date(Date.UTC(y, mo, 1));
        while (d.getUTCMonth() === mo) {
            if (d.getUTCDay() === 0) { count++; if (count === nth) break; }
            d.setUTCDate(d.getUTCDate() + 1);
        }
        d.setUTCHours(6, 0, 0, 0);
        return d;
    }
    const dstStart = nthSun(year, 2, 2);
    const dstEnd   = nthSun(year, 10, 1);
    if (utcDate >= dstStart && utcDate < dstEnd) return 4;
    return 5;
}

// Parse "8:00 PM EST | ..." → UTC Date on the session's scheduled day
function sessionTimeToUTC(timeStr, dayLabel, weekStartStr) {
    const estPart   = timeStr.split('|')[0].trim();
    const cleanTime = estPart.replace('EST', '').replace('EDT', '').trim();
    const [timePart, period] = cleanTime.split(' ');
    let [hours, minutes] = timePart.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const [y, m, d] = weekStartStr.split('-').map(Number);
    const monday = new Date(Date.UTC(y, m - 1, d));
    const dayIdx = DAYS.indexOf(dayLabel);
    const dayDate = new Date(monday.getTime() + dayIdx * 86400 * 1000);

    const probe = new Date(Date.UTC(
        dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(), 0, 0, 0
    ));
    const offset = getEasternOffsetHours(probe);
    return new Date(Date.UTC(
        dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(),
        hours + offset, minutes, 0, 0
    ));
}

// Current week start (Monday) as YYYY-MM-DD in ET
function getCurrentWeekStart() {
    const now = new Date();
    const etOffset = getEasternOffsetHours(now);
    const etMs  = now.getTime() - etOffset * 3600 * 1000;
    const etNow = new Date(etMs);
    const daysFromMon = (etNow.getUTCDay() + 6) % 7;
    const mon = new Date(etMs - daysFromMon * 86400 * 1000);
    return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth()+1).padStart(2,'0')}-${String(mon.getUTCDate()).padStart(2,'0')}`;
}

function startApiServer(client) {
    const app  = express();
    const PORT = process.env.API_PORT || 3001;
    app.use(express.json());

    // Simple API key auth — set ROBLOX_API_KEY env var on Railway
    function requireKey(req, res, next) {
        const apiKey = process.env.ROBLOX_API_KEY;
        if (!apiKey) return next(); // if not set, open (dev mode)
        const provided = req.headers['x-api-key'] || req.query.key;
        if (provided !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
        next();
    }

    // ── GET /api/sessions/upcoming ───────────────────────────────────────────────
    // Returns sessions starting within the next 15 minutes that have a linked Roblox user.
    // Also returns any approved session starting in the next 24h (for joining-late check).
    // Response: [{ sessionId, robloxUserId, hostDiscordId, hostName, sessionTime (ISO), day, timeLabel, minutesUntil }]
    app.get('/api/sessions/upcoming', requireKey, async (req, res) => {
        try {
            const weekStart = getCurrentWeekStart();
            const now = new Date();

            const sessions = await Session.find({
                weekStart,
                status: { $in: ['pending', 'approved'] }
            });

            const result = [];
            for (const s of sessions) {
                if (!s.scheduledDay || !s.time) continue;

                const sessionUTC = sessionTimeToUTC(s.time, s.scheduledDay, s.weekStart || weekStart);
                const minutesUntil = (sessionUTC - now) / 60000;

                // Include sessions from -5 min (just started) to +24h (for join-late UI)
                if (minutesUntil < -5 || minutesUntil > 1440) continue;

                // Look up Roblox link for the host
                const link = await RobloxLink.findOne({ discordId: s.hostDiscordId });
                if (!link) continue;

                result.push({
                    sessionId:     s._id.toString(),
                    robloxUserId:  link.robloxUserId,
                    robloxUsername: link.robloxUsername,
                    hostDiscordId: s.hostDiscordId,
                    hostName:      s.hostName,
                    sessionTime:   sessionUTC.toISOString(),
                    day:           s.scheduledDay,
                    timeLabel:     s.time.split('|')[0].trim(),
                    minutesUntil:  Math.round(minutesUntil),
                    shiftType:     s.shiftType || 'Regular Shift',
                });
            }

            res.json(result);
        } catch (err) {
            console.error('[roblox-api] /upcoming error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/sessions/:id/status ────────────────────────────────────────────
    // Called by Roblox when the host responds to the in-game prompt.
    // Body: { action: 'ready' | 'delay' | 'cancel', robloxUserId: number }
    app.post('/api/sessions/:id/status', requireKey, async (req, res) => {
        try {
            const { action, robloxUserId } = req.body;
            if (!action || !robloxUserId) return res.status(400).json({ error: 'Missing action or robloxUserId' });

            const session = await Session.findById(req.params.id);
            if (!session) return res.status(404).json({ error: 'Session not found' });

            // Verify the caller is actually the host
            const link = await RobloxLink.findOne({ robloxUserId: String(robloxUserId) });
            if (!link || link.discordId !== session.hostDiscordId) {
                return res.status(403).json({ error: 'Not the session host' });
            }

            const weekStart = session.weekStart || getCurrentWeekStart();
            const sessionUTC = sessionTimeToUTC(session.time, session.scheduledDay, weekStart);
            const timeLabel  = session.time.split('|')[0].trim();

            if (action === 'ready') {
                session.status = 'active';
                await session.save();

                // Ping announcement channel
                await notifySessionReady(client, session, timeLabel);
                return res.json({ ok: true, message: 'Session marked active' });
            }

            if (action === 'delay') {
                // Push session time by 15 minutes — we store this as a note since time slots are fixed
                session.delayMinutes = (session.delayMinutes || 0) + 15;
                await session.save();
                await notifySessionDelayed(client, session, timeLabel, session.delayMinutes);
                return res.json({ ok: true, message: `Session delayed by ${session.delayMinutes} min total` });
            }

            if (action === 'cancel') {
                session.status = 'cancelled';
                await session.save();
                await notifySessionCancelled(client, session, timeLabel, 'cancelled in-game by host');
                return res.json({ ok: true, message: 'Session cancelled' });
            }

            return res.status(400).json({ error: 'Unknown action' });
        } catch (err) {
            console.error('[roblox-api] /status error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Notification helpers ─────────────────────────────────────────────────────
    const ANNOUNCEMENT_CHANNEL_ID = '1385105286926172160';
    const ANNOUNCEMENT_GUILD_ID   = '1370892833182974035';
    const SHIFT_PING_ROLE_ID      = '1371568661592019044';
    const TRAINING_PING_ROLE_ID   = '1371568736569659462';

    async function getAnnouncementChannel() {
        try {
            const guild = await client.guilds.fetch(ANNOUNCEMENT_GUILD_ID);
            return await guild.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        } catch { return null; }
    }

    // DM the host directly (keeps the schedule channel clean)
    async function dmHost(client, discordId, embedData) {
        try {
            const user = await client.users.fetch(discordId);
            await user.send({ embeds: [embedData] });
        } catch (err) {
            console.warn(`[roblox-api] Could not DM host ${discordId}:`, err.message);
        }
    }

    async function notifySessionReady(client, session, timeLabel) {
        // DM the host a confirmation their session is live
        await dmHost(client, session.hostDiscordId, {
            color: 0x57F287,
            title: '🟢 Session Marked Active',
            description: `You confirmed ready in-game! Your **${session.shiftType || 'Regular Shift'}** is now active.`,
            fields: [{ name: 'Time', value: timeLabel, inline: true }],
            footer: { text: 'Kavià Café Session System' },
            timestamp: new Date().toISOString(),
        });

        // Announce to the public channel that a session is live
        const ch = await getAnnouncementChannel();
        if (!ch) return;
        const pingRole = session.shiftType === 'Recruitment Shift' ? TRAINING_PING_ROLE_ID : SHIFT_PING_ROLE_ID;
        await ch.send({
            content: `<@&${pingRole}>`,
            embeds: [{
                color: 0x57F287,
                title: '🟢 Session Starting Now',
                description: `**${session.hostName}** is hosting a **${session.shiftType || 'Regular Shift'}**!\n\nJoin the game now to participate.`,
                fields: [{ name: 'Scheduled Time', value: timeLabel, inline: true }],
                footer: { text: 'Kavià Café Session System' },
                timestamp: new Date().toISOString(),
            }]
        });
    }

    async function notifySessionDelayed(client, session, timeLabel, totalDelay) {
        // DM the host only — no need to spam the channel for a delay
        await dmHost(client, session.hostDiscordId, {
            color: 0xFEE75C,
            title: '⏳ Session Delayed',
            description: `Your session has been delayed by **${totalDelay} minutes total** from the original time.\n\nYou'll receive another in-game prompt when the new time approaches.`,
            fields: [{ name: 'Original Time', value: timeLabel, inline: true }],
            footer: { text: 'Kavià Café Session System' },
            timestamp: new Date().toISOString(),
        });
    }

    async function notifySessionCancelled(client, session, timeLabel, reason) {
        // DM the host
        await dmHost(client, session.hostDiscordId, {
            color: 0xED4245,
            title: '❌ Session Cancelled',
            description: `Your session at **${timeLabel}** has been cancelled.\n*Reason: ${reason}*`,
            footer: { text: 'Kavià Café Session System' },
            timestamp: new Date().toISOString(),
        });

        // Also post to announcement channel so staff know
        const ch = await getAnnouncementChannel();
        if (ch) await ch.send({
            embeds: [{
                color: 0xED4245,
                title: '❌ Session Cancelled',
                description: `**${session.hostName}**'s session at **${timeLabel}** has been cancelled.`,
                footer: { text: 'Kavià Café Session System' },
                timestamp: new Date().toISOString(),
            }]
        });
    }

    app.listen(PORT, () => {
        console.log(`[roblox-api] HTTP server listening on port ${PORT}`);
    });
}

module.exports = { startApiServer };