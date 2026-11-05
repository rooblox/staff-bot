/**
 * sesschedule.js — Weekly Session Schedule System for Kavià Café
 *
 * Replaces the /sesrequest slash command with a weekly interactive schedule post.
 * Posts every Sunday at 11 PM EST. Users click day buttons to claim time slots.
 * Approval flow, reminders, co-host support, and cancel/manage are all included.
 *
 * SETUP IN index.js:
 *   const { initScheduleSystem } = require('./commands/sesschedule');
 *   client.once('ready', () => { initScheduleSystem(client); });
 *
 *   // Button/select/modal handler — add inside interactionCreate:
 *   const { handleScheduleInteraction } = require('./commands/sesschedule');
 *   if (await handleScheduleInteraction(interaction, client)) return;
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const { Session, SchedulePost } = require('../db');
const path = require('path');

// Lazy-load canvas — if not installed the banner is silently skipped
let _canvas = null;
function getCanvas() {
    if (_canvas) return _canvas;
    try { _canvas = require('@napi-rs/canvas'); } catch { _canvas = false; }
    return _canvas;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SCHEDULE_GUILD_ID    = '1434556801096876034';
const SCHEDULE_CHANNEL_ID  = '1493737208597971045'; // weekly schedule post lives here
const REQUEST_CHANNEL_ID   = '1568027695718080552'; // approval requests go here
const PING_ROLE_ID         = '1439608585381478471';
const REQUIRED_ROLE_ID    = '1434563855354167358';
const ANNOUNCEMENT_CHANNEL_ID = '1385105286926172160';
const ANNOUNCEMENT_GUILD_ID   = '1370892833182974035';
const SHIFT_PING_ROLE_ID      = '1371568661592019044';
const TRAINING_PING_ROLE_ID   = '1371568736569659462';

const MAX_SESSIONS_PER_WEEK = 7;
const MIN_SESSIONS_PER_WEEK = 2; // soft reminder only, not enforced

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Short index maps — keep custom IDs well under Discord's 100-char limit
const SHIFT_TYPES = ['Regular Shift', 'Recruitment Shift']; // s0, s1
// Time index helpers
function timeIndex(val) { return SHIFT_TIMES.findIndex(t => t.value === val); }  // → 0–11
function timeFromIndex(i) { return SHIFT_TIMES[i]?.value ?? null; }
function shiftIndex(val) { return SHIFT_TYPES.indexOf(val); }                    // → 0 or 1
function shiftFromIndex(i) { return SHIFT_TYPES[i] ?? null; }

const SHIFT_TIMES = [
    { label: '12:00 AM EST | 6:00 AM CET | 9:00 PM PT',  value: '12:00 AM EST | 6:00 AM CET | 9:00 PM PT'  },
    { label: '2:00 AM EST | 8:00 AM CET | 11:00 PM PT',  value: '2:00 AM EST | 8:00 AM CET | 11:00 PM PT'  },
    { label: '4:00 AM EST | 10:00 AM CET | 1:00 AM PT',  value: '4:00 AM EST | 10:00 AM CET | 1:00 AM PT'  },
    { label: '6:00 AM EST | 12:00 PM CET | 3:00 AM PT',  value: '6:00 AM EST | 12:00 PM CET | 3:00 AM PT'  },
    { label: '8:00 AM EST | 2:00 PM CET | 5:00 AM PT',   value: '8:00 AM EST | 2:00 PM CET | 5:00 AM PT'   },
    { label: '10:00 AM EST | 4:00 PM CET | 7:00 AM PT',  value: '10:00 AM EST | 4:00 PM CET | 7:00 AM PT'  },
    { label: '12:00 PM EST | 6:00 PM CET | 9:00 AM PT',  value: '12:00 PM EST | 6:00 PM CET | 9:00 AM PT'  },
    { label: '2:00 PM EST | 8:00 PM CET | 11:00 AM PT',  value: '2:00 PM EST | 8:00 PM CET | 11:00 AM PT'  },
    { label: '4:00 PM EST | 10:00 PM CET | 1:00 PM PT',  value: '4:00 PM EST | 10:00 PM CET | 1:00 PM PT'  },
    { label: '6:00 PM EST | 12:00 AM CET | 3:00 PM PT',  value: '6:00 PM EST | 12:00 AM CET | 3:00 PM PT'  },
    { label: '8:00 PM EST | 2:00 AM CET | 5:00 PM PT',   value: '8:00 PM EST | 2:00 AM CET | 5:00 PM PT'   },
    { label: '10:00 PM EST | 4:00 AM CET | 7:00 PM PT',  value: '10:00 PM EST | 4:00 AM CET | 7:00 PM PT'  },
];

// In-memory store for the current week's schedule post message ID
// (also persisted in Session documents tagged with weekStart)
let currentScheduleMessageId = null;
let currentWeekStart = null; // ISO string of Monday 00:00 UTC for this week

// ─── DST-aware time helpers (same logic as sesrequest.js) ─────────────────────
function getEasternOffsetHours(utcDate) {
    const year = utcDate.getUTCFullYear();
    const dstStart = nthSundayUTC(year, 2, 2);
    const dstEnd   = nthSundayUTC(year, 10, 1);
    if (utcDate >= dstStart && utcDate < dstEnd) return 4;
    return 5;
}

function nthSundayUTC(year, month, nth) {
    let count = 0;
    const d = new Date(Date.UTC(year, month, 1));
    while (d.getUTCMonth() === month) {
        if (d.getUTCDay() === 0) { count++; if (count === nth) break; }
        d.setUTCDate(d.getUTCDate() + 1);
    }
    d.setUTCHours(6, 0, 0, 0);
    return d;
}

function parseSessionTime(timeStr) {
    const estPart   = timeStr.split('|')[0].trim();
    const cleanTime = estPart.replace('EST', '').replace('EDT', '').trim();
    const [time, period] = cleanTime.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    const now = new Date();
    const candidate = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        hours + getEasternOffsetHours(now), minutes, 0, 0
    ));
    if (candidate <= now) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
        return new Date(Date.UTC(
            candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(),
            hours + getEasternOffsetHours(candidate), minutes, 0, 0
        ));
    }
    return candidate;
}

// ─── Week helpers ─────────────────────────────────────────────────────────────
// Returns the UTC date string (YYYY-MM-DD) of Monday of the current ET week
function getCurrentWeekStart() {
    const now = new Date();
    const etOffset = getEasternOffsetHours(now);
    // Convert UTC to ET
    const etMs  = now.getTime() - etOffset * 3600 * 1000;
    const etNow = new Date(etMs);
    // Find Monday (day 1; Sunday = 0)
    const dayOfWeek = etNow.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysFromMon = (dayOfWeek + 6) % 7; // 0 on Mon, 6 on Sun
    const mon = new Date(etMs - daysFromMon * 86400 * 1000);
    return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`;
}

// Returns the actual UTC Date of a given day label (e.g. 'Thursday') in the current week
function getDateForDayThisWeek(dayLabel) {
    const weekStartStr = getCurrentWeekStart();
    const [y, m, d] = weekStartStr.split('-').map(Number);
    const monday = new Date(Date.UTC(y, m - 1, d));
    const dayIdx = DAYS_OF_WEEK.indexOf(dayLabel); // 0=Mon, 6=Sun
    const target = new Date(monday.getTime() + dayIdx * 86400 * 1000);
    return target;
}

// Returns true if a day label is in the future (or today) relative to ET now
function isDayAvailable(dayLabel) {
    const now = new Date();
    const etOffset = getEasternOffsetHours(now);
    const etNow = new Date(now.getTime() - etOffset * 3600 * 1000);
    const target = getDateForDayThisWeek(dayLabel);
    // available if target date >= today in ET
    const etToday = new Date(Date.UTC(etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate()));
    return target >= etToday;
}

// ─── Build the schedule embed ──────────────────────────────────────────────────
async function buildScheduleEmbed(weekStartStr) {
    // Load all sessions for this week
    const sessions = await Session.find({
        weekStart: weekStartStr,
        status: { $in: ['pending', 'approved', 'active'] }
    }).sort({ time: 1 });

    const embed = new EmbedBuilder()
        .setTitle('📅  Weekly Session Schedule')
        .setColor(0x5865F2)
        .setDescription(
            `Welcome to this week's session schedule!\n\n` +
            `Click a **day button** below to claim a time slot.\n` +
            `You may claim up to **${MAX_SESSIONS_PER_WEEK} sessions** per week (minimum **${MIN_SESSIONS_PER_WEEK}**).\n` +
            `All requests require staff approval — first come, first served.\n` +
            `> Schedule resets every **Sunday at 11 PM EST**`
        )
        .setFooter({ text: `Kavià Café • Week of ${weekStartStr}` })
        .setTimestamp();

    // Group sessions by day
    const byDay = {};
    for (const day of DAYS_OF_WEEK) byDay[day] = [];
    for (const s of sessions) {
        if (s.scheduledDay && byDay[s.scheduledDay]) {
            byDay[s.scheduledDay].push(s);
        }
    }

    // Add a field per day
    for (const day of DAYS_OF_WEEK) {
        const daySessions = byDay[day];
        const available   = isDayAvailable(day);
        const dateObj     = getDateForDayThisWeek(day);
        const dateStr     = `${dateObj.getUTCMonth() + 1}/${dateObj.getUTCDate()}`;
        const dayHeader   = `${available ? '🟢' : '⬛'} **${day}** *(${dateStr})*`;

        let value;
        if (!available) {
            value = '*Past*';
        } else if (daySessions.length === 0) {
            value = '*No sessions claimed yet*';
        } else {
            value = daySessions.map(s => {
                const statusIcon = s.status === 'approved' ? '✅' : '🕐';
                const timeShort  = s.time.split('|')[0].trim();
                const cohostPart = s.coHostId ? ` *(co-host: <@${s.coHostId}>)*` : '';
                return `${statusIcon} <@${s.hostId}>${cohostPart}\n　　\`${timeShort}\``;
            }).join('\n');
        }

        embed.addFields({ name: dayHeader, value: value.slice(0, 1024), inline: false });
    }

    return embed;
}

// ─── Build day buttons (row 1: Mon–Thu, row 2: Fri–Sun + Manage) ──────────────
function buildDayButtons() {
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    for (let i = 0; i < 4; i++) {
        const day = DAYS_OF_WEEK[i];
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(`sched_claim_${day}`)
                .setLabel(day)
                .setStyle(isDayAvailable(day) ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!isDayAvailable(day))
        );
    }

    for (let i = 4; i < 7; i++) {
        const day = DAYS_OF_WEEK[i];
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId(`sched_claim_${day}`)
                .setLabel(day)
                .setStyle(isDayAvailable(day) ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!isDayAvailable(day))
        );
    }

    row2.addComponents(
        new ButtonBuilder()
            .setCustomId('sched_manage')
            .setLabel('📋 Manage My Sessions')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

// ─── Banner image generator ───────────────────────────────────────────────────
// Returns an AttachmentBuilder (banner.png) for the weekly schedule post.
// weekStartStr = 'YYYY-MM-DD' of Monday for the current week.
async function generateScheduleBanner(weekStartStr) {
    const cv = getCanvas();
    if (!cv) return null; // canvas not installed — skip banner gracefully

    const { createCanvas, loadImage } = cv;
    const W = 960, H = 200;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // ── Background image ──────────────────────────────────────────────────────
    const bgPath = path.join(__dirname, 'schedule-banner-bg.png');
    const bg     = await loadImage(bgPath);
    const srcW   = bg.width, srcH = bg.height;

    // Crop: maintain W:H ratio, shift left so palm tree pillar is in frame
    const cropH = srcH;
    const cropW = Math.min(Math.floor(cropH * W / H), srcW);
    const cropX = Math.floor((srcW - cropW) * 0.08); // 8% from left edge
    const cropY = Math.floor((srcH - cropH) * 0.3);
    ctx.drawImage(bg, cropX, cropY, cropW, cropH, 0, 0, W, H);

    // ── Brightness / color boost (simulate Pillow enhance) ───────────────────
    // Darken slightly via semi-transparent overlay then draw image brighter using globalAlpha
    // We achieve this with a multiply-style dark overlay at the end instead.

    // ── Vignette — asymmetric: lighter on left, heavier on right ─────────────
    // Right-side vignette
    const gradR = ctx.createLinearGradient(W * 0.6, 0, W, 0);
    gradR.addColorStop(0, 'rgba(8,4,22,0)');
    gradR.addColorStop(1, 'rgba(8,4,22,0.72)');
    ctx.fillStyle = gradR;
    ctx.fillRect(0, 0, W, H);

    // Left-side vignette (much softer)
    const gradL = ctx.createLinearGradient(0, 0, W * 0.18, 0);
    gradL.addColorStop(0, 'rgba(8,4,22,0.38)');
    gradL.addColorStop(1, 'rgba(8,4,22,0)');
    ctx.fillStyle = gradL;
    ctx.fillRect(0, 0, W, H);

    // Top vignette
    const gradT = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    gradT.addColorStop(0, 'rgba(6,3,18,0.55)');
    gradT.addColorStop(1, 'rgba(6,3,18,0)');
    ctx.fillStyle = gradT;
    ctx.fillRect(0, 0, W, H);

    // Bottom vignette
    const gradB = ctx.createLinearGradient(0, H * 0.6, 0, H);
    gradB.addColorStop(0, 'rgba(6,3,18,0)');
    gradB.addColorStop(1, 'rgba(6,3,18,0.55)');
    ctx.fillStyle = gradB;
    ctx.fillRect(0, 0, W, H);

    // ── Neon strips ───────────────────────────────────────────────────────────
    // Pink top strip
    ctx.fillStyle = 'rgb(235,65,185)';
    ctx.fillRect(0, 0, W, 2);
    const gradPinkGlow = ctx.createLinearGradient(0, 2, 0, 22);
    gradPinkGlow.addColorStop(0, 'rgba(235,65,185,0.45)');
    gradPinkGlow.addColorStop(1, 'rgba(235,65,185,0)');
    ctx.fillStyle = gradPinkGlow;
    ctx.fillRect(0, 2, W, 20);

    // Blue bottom strip
    ctx.fillStyle = 'rgb(100,118,255)';
    ctx.fillRect(0, H - 2, W, 2);
    const gradBlueGlow = ctx.createLinearGradient(0, H - 18, 0, H - 2);
    gradBlueGlow.addColorStop(0, 'rgba(100,118,255,0)');
    gradBlueGlow.addColorStop(1, 'rgba(100,118,255,0.45)');
    ctx.fillStyle = gradBlueGlow;
    ctx.fillRect(0, H - 18, W, 16);

    // ── Register fonts if available (Railway/Debian container paths) ─────────
    const { registerFont } = cv;
    const fontCandidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    ];
    const fontRegCandidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
        '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
    ];
    const fs2 = require('fs');
    for (const f of fontCandidates) {
        if (fs2.existsSync(f)) { try { registerFont(f, { family: 'KaviaFont', weight: 'bold' }); } catch {} break; }
    }
    for (const f of fontRegCandidates) {
        if (fs2.existsSync(f)) { try { registerFont(f, { family: 'KaviaFont', weight: 'normal' }); } catch {} break; }
    }

    // ── Title: "KAVIA CAFÉ" ───────────────────────────────────────────────────
    const titleFont = 'bold 64px KaviaFont, Arial, sans-serif';
    const titleY    = 95; // baseline

    ctx.font      = titleFont;
    ctx.textAlign = 'center';

    // Shadow pass
    ctx.fillStyle   = 'rgba(5,3,15,0.9)';
    ctx.shadowColor = 'transparent';
    ctx.fillText('KAVIA CAFÉ', W / 2 + 3, titleY + 4);

    // Blue-purple neon glow (blurred via large shadow)
    ctx.shadowColor   = 'rgba(60,70,220,0.7)';
    ctx.shadowBlur    = 24;
    ctx.fillStyle     = 'rgba(60,70,220,0.6)';
    ctx.fillText('KAVIA CAFÉ', W / 2, titleY);

    // Second glow pass (wider)
    ctx.shadowColor = 'rgba(40,50,180,0.5)';
    ctx.shadowBlur  = 42;
    ctx.fillStyle   = 'rgba(40,50,180,0.4)';
    ctx.fillText('KAVIA CAFÉ', W / 2, titleY);

    // Main text — blue-purple
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgb(155,165,255)';
    ctx.fillText('KAVIA CAFÉ', W / 2, titleY);

    // White-soft highlight
    ctx.fillStyle = 'rgb(230,225,255)';
    ctx.fillText('KAVIA CAFÉ', W / 2 - 1, titleY - 1);

    // ── Subtitle: "SESSION SCHEDULE" ─────────────────────────────────────────
    const subFont = 'bold 12px KaviaFont, Arial, sans-serif';
    const subText = 'S E S S I O N   S C H E D U L E';
    const subY    = titleY + 24;

    ctx.font      = subFont;
    ctx.textAlign = 'center';

    // Shadow
    ctx.fillStyle = 'rgba(10,5,30,0.8)';
    ctx.fillText(subText, W / 2 + 1, subY + 1);

    // Pink text
    ctx.fillStyle = 'rgb(210,120,190)';
    ctx.fillText(subText, W / 2, subY);

    // Measure for divider lines
    ctx.font = subFont;
    const subW = ctx.measureText(subText).width;
    const pad  = 18;
    const lineY = subY + 5;

    ctx.strokeStyle = 'rgb(160,50,130)';
    ctx.lineWidth   = 1;

    ctx.beginPath();
    ctx.moveTo(40, lineY);
    ctx.lineTo(W / 2 - subW / 2 - pad, lineY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(W / 2 + subW / 2 + pad, lineY);
    ctx.lineTo(W - 40, lineY);
    ctx.stroke();

    // Dot accents
    for (const dotX of [W / 2 - subW / 2 - pad, W / 2 + subW / 2 + pad]) {
        ctx.beginPath();
        ctx.arc(dotX, lineY, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgb(235,65,185)';
        ctx.fill();
    }

    // ── Date pill ─────────────────────────────────────────────────────────────
    // Compute "MON DD – MON DD" for the week
    const [wy, wm, wd] = weekStartStr.split('-').map(Number);
    const monday = new Date(Date.UTC(wy, wm - 1, wd));
    const sunday = new Date(monday.getTime() + 6 * 86400 * 1000);
    const MONTHS  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const monStr  = `${MONTHS[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
    const sunStr  = `${MONTHS[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`;
    const dateRange  = `${monStr} – ${sunStr}`;
    const weekLabel  = 'WEEK OF';

    const bigFont  = 'bold 17px KaviaFont, Arial, sans-serif';
    const smlFont  = '11px KaviaFont, Arial, sans-serif';

    ctx.font = bigFont;
    const dateW = ctx.measureText(dateRange).width;
    ctx.font = smlFont;
    const labelW = ctx.measureText(weekLabel).width;

    const blockW  = Math.max(dateW, labelW) + 24;
    const blockH  = 42;
    const bx      = W - blockW - 28;
    const by      = H - blockH - 10;
    const radius  = 8;

    // Rounded rect fill
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.lineTo(bx + blockW - radius, by);
    ctx.quadraticCurveTo(bx + blockW, by, bx + blockW, by + radius);
    ctx.lineTo(bx + blockW, by + blockH - radius);
    ctx.quadraticCurveTo(bx + blockW, by + blockH, bx + blockW - radius, by + blockH);
    ctx.lineTo(bx + radius, by + blockH);
    ctx.quadraticCurveTo(bx, by + blockH, bx, by + blockH - radius);
    ctx.lineTo(bx, by + radius);
    ctx.quadraticCurveTo(bx, by, bx + radius, by);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(20,10,45,0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,50,130,0.85)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // "WEEK OF" label
    ctx.font      = smlFont;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgb(200,100,175)';
    ctx.fillText(weekLabel, bx + blockW / 2, by + 17);

    // Date range
    ctx.font      = bigFont;
    ctx.textAlign = 'center';

    // Shadow
    ctx.fillStyle = 'rgba(10,5,30,0.8)';
    ctx.fillText(dateRange, bx + blockW / 2 + 1, by + 34);

    // Main
    ctx.fillStyle = 'rgb(210,215,255)';
    ctx.fillText(dateRange, bx + blockW / 2, by + 33);

    // ── Export as AttachmentBuilder ───────────────────────────────────────────
    const buffer = canvas.toBuffer('image/png');
    // Return both the attachment and the attachment:// URL for embed.setImage()
    const attachment = new AttachmentBuilder(buffer, { name: 'schedule-banner.png' });
    return attachment;
}

// ─── Post (or refresh) the weekly schedule ────────────────────────────────────
async function postWeeklySchedule(client, forceNew = false) {
    try {
        const channel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
        if (!channel?.isTextBased()) return;

        const weekStart = getCurrentWeekStart();
        const embed     = await buildScheduleEmbed(weekStart);
        const rows      = buildDayButtons();

        // Generate banner (gracefully skip if canvas fails)
        // Banner is set as embed image (attachment://) so it appears BELOW the embed text
        let banner = null;
        try { banner = await generateScheduleBanner(weekStart); } catch (err) {
            console.warn('[sesschedule] Banner generation failed, posting without image:', err.message);
        }
        if (banner) embed.setImage('attachment://schedule-banner.png');

        if (!forceNew && currentScheduleMessageId) {
            // Try to edit the existing message
            try {
                const msg = await channel.messages.fetch(currentScheduleMessageId);
                await msg.edit({
                    embeds: [embed],
                    components: rows,
                    ...(banner ? { files: [banner] } : {})
                });
                currentWeekStart = weekStart;
                return msg;
            } catch {
                // Message gone — fall through to post new
            }
        }

        // Post fresh (includes banner image inside the embed)
        const sendPayload = { embeds: [embed], components: rows };
        if (banner) sendPayload.files = [banner];
        const msg = await channel.send(sendPayload);
        currentScheduleMessageId = msg.id;
        currentWeekStart = weekStart;
        // Persist so restarts don't re-post
        await SchedulePost.findByIdAndUpdate('singleton',
            { weekStart, messageId: msg.id, channelId: SCHEDULE_CHANNEL_ID, updatedAt: new Date() },
            { upsert: true }
        );
        console.log(`✅ Weekly session schedule posted: ${msg.id} (week ${weekStart})`);
        return msg;

    } catch (err) {
        console.error('[sesschedule] Error posting weekly schedule:', err);
    }
}

// ─── Refresh the schedule embed in-place (called after any claim/cancel) ──────
async function refreshSchedule(client) {
    await postWeeklySchedule(client, false);
}

// ─── Sunday 11 PM EST reset scheduler ────────────────────────────────────────
function scheduleSundayReset(client) {
    function msUntilNextSundayReset() {
        const now      = new Date();
        const etOffset = getEasternOffsetHours(now);
        const etNow    = new Date(now.getTime() - etOffset * 3600 * 1000);

        // Find the next Sunday
        const daysUntilSun = (7 - etNow.getUTCDay()) % 7 || 7;
        const nextSunday   = new Date(Date.UTC(
            etNow.getUTCFullYear(), etNow.getUTCMonth(),
            etNow.getUTCDate() + daysUntilSun,
            23, 0, 0, 0 // 11 PM ET expressed in ET-local hours
        ));
        // Convert back to UTC: Sunday 23:00 ET = Sunday 23:00 + etOffset in UTC
        const nextResetUTC = new Date(nextSunday.getTime() + etOffset * 3600 * 1000);
        return nextResetUTC.getTime() - now.getTime();
    }

    function scheduleNext() {
        const ms = msUntilNextSundayReset();
        console.log(`[sesschedule] Next Sunday reset in ${Math.round(ms / 60000)} minutes`);
        setTimeout(async () => {
            await postWeeklySchedule(client, true); // force new post
            scheduleNext(); // schedule the one after that
        }, ms);
    }

    scheduleNext();
}

// ─── Permission check ─────────────────────────────────────────────────────────
async function hasSessionRole(client, userId) {
    try {
        const guild  = await client.guilds.fetch(SCHEDULE_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        return member && member.roles.cache.has(REQUIRED_ROLE_ID);
    } catch { return false; }
}

// ─── Main interaction handler ─────────────────────────────────────────────────
// Returns true if the interaction was handled by this module
async function handleScheduleInteraction(interaction, client) {
    const id = interaction.customId || '';

    // ── Day claim button ──────────────────────────────────────────────────────
    if (id.startsWith('sched_claim_')) {
        const day = id.replace('sched_claim_', '');
        if (!DAYS_OF_WEEK.includes(day)) return false;

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        if (!await hasSessionRole(client, interaction.user.id)) {
            await interaction.editReply({ content: '❌ You do not have permission to claim session slots.' });
            return true;
        }

        if (!isDayAvailable(day)) {
            await interaction.editReply({ content: `❌ **${day}** has already passed this week.` });
            return true;
        }

        const weekStart = getCurrentWeekStart();

        // Check weekly cap
        const myCount = await Session.countDocuments({
            hostId: interaction.user.id,
            weekStart,
            status: { $in: ['pending', 'approved', 'active'] }
        });
        if (myCount >= MAX_SESSIONS_PER_WEEK) {
            await interaction.editReply({ content: `❌ You've reached the maximum of **${MAX_SESSIONS_PER_WEEK} sessions** this week.` });
            return true;
        }

        // Show time select
        const availableTimes = await getAvailableTimesForDay(day, weekStart);
        if (availableTimes.length === 0) {
            await interaction.editReply({ content: `❌ All time slots for **${day}** are taken or pending approval.` });
            return true;
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`sched_time_${day}`)
            .setPlaceholder('Select a time slot...')
            .addOptions(availableTimes.map(t =>
                new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.value)
            ));

        await interaction.editReply({
            content: `**📅 Claiming a slot for ${day}**\nSelect your preferred time:`,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
        return true;
    }

    // ── Time select ───────────────────────────────────────────────────────────
    if (id.startsWith('sched_time_')) {
        const day      = id.replace('sched_time_', '');
        const timeVal  = interaction.values?.[0];
        if (!timeVal) return false;

        await interaction.deferUpdate().catch(() => {});

        const weekStart = getCurrentWeekStart();

        // Double-check slot still available (race condition guard)
        const taken = await Session.findOne({
            scheduledDay: day,
            time: timeVal,
            weekStart,
            status: { $in: ['pending', 'approved', 'active'] }
        });
        if (taken) {
            await interaction.editReply({
                content: `❌ That slot was just taken! Please try a different time.`,
                components: []
            });
            return true;
        }

        // Show shift type + co-host options
        const ti = timeIndex(timeVal);
        const shiftSelect = new StringSelectMenuBuilder()
            .setCustomId(`sched_shifttype_${day}_${ti}`)
            .setPlaceholder('Select shift type...')
            .addOptions([
                new StringSelectMenuOptionBuilder().setLabel('Regular Shift').setValue('Regular Shift'),
                new StringSelectMenuOptionBuilder().setLabel('Recruitment Shift').setValue('Recruitment Shift'),
            ]);

        await interaction.editReply({
            content: `**📅 ${day} — \`${timeVal.split('|')[0].trim()}\`**\nSelect your shift type:`,
            components: [new ActionRowBuilder().addComponents(shiftSelect)]
        });
        return true;
    }

    // ── Shift type select ─────────────────────────────────────────────────────
    if (id.startsWith('sched_shifttype_')) {
        const parts     = id.replace('sched_shifttype_', '').split('_');
        const day       = parts[0];
        const ti        = parseInt(parts[1], 10);
        const timeVal   = timeFromIndex(ti);
        const shiftType = interaction.values?.[0];
        if (!shiftType || !timeVal) return false;

        await interaction.deferUpdate().catch(() => {});

        const si = shiftIndex(shiftType);
        // Ask about co-host — IDs: sched_cohost_{yes|no}_{day}_{ti}_{si}
        const coHostBtn = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sched_cohost_yes_${day}_${ti}_${si}`)
                .setLabel('➕ Add a Co-Host')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`sched_cohost_no_${day}_${ti}_${si}`)
                .setLabel('No Co-Host')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({
            content: `**📅 ${day} — \`${timeVal.split('|')[0].trim()}\` — ${shiftType}**\nWould you like to add a co-host?`,
            components: [coHostBtn]
        });
        return true;
    }

    // ── Co-host: no ───────────────────────────────────────────────────────────
    if (id.startsWith('sched_cohost_no_')) {
        const parts     = id.replace('sched_cohost_no_', '').split('_');
        const day       = parts[0];
        const timeVal   = timeFromIndex(parseInt(parts[1], 10));
        const shiftType = shiftFromIndex(parseInt(parts[2], 10));
        if (!timeVal || !shiftType) return false;

        await interaction.deferUpdate().catch(() => {});
        await showReminderOptions(interaction, day, timeVal, shiftType, null);
        return true;
    }

    // ── Co-host: yes → show modal ─────────────────────────────────────────────
    if (id.startsWith('sched_cohost_yes_')) {
        const parts     = id.replace('sched_cohost_yes_', '').split('_');
        const day       = parts[0];
        const ti        = parts[1];
        const si        = parts[2];
        const timeVal   = timeFromIndex(parseInt(ti, 10));
        const shiftType = shiftFromIndex(parseInt(si, 10));
        if (!timeVal || !shiftType) return false;

        // Modal ID: sched_cohost_modal_{day}_{ti}_{si}  — well under 100 chars
        const modal = new ModalBuilder()
            .setCustomId(`sched_cohost_modal_${day}_${ti}_${si}`)
            .setTitle('Add a Co-Host');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cohost_id')
                    .setLabel('Co-host Discord User ID')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Right-click user → Copy User ID')
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    // ── Co-host modal submit ──────────────────────────────────────────────────
    if (id.startsWith('sched_cohost_modal_')) {
        const parts     = id.replace('sched_cohost_modal_', '').split('_');
        const day       = parts[0];
        const timeVal   = timeFromIndex(parseInt(parts[1], 10));
        const shiftType = shiftFromIndex(parseInt(parts[2], 10));
        const rawId     = interaction.fields.getTextInputValue('cohost_id').trim();
        if (!timeVal || !shiftType) return false;

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        // Validate the user ID
        let coHostUser = null;
        try { coHostUser = await interaction.client.users.fetch(rawId); } catch {}
        if (!coHostUser) {
            await interaction.editReply({ content: `❌ Couldn't find a user with ID \`${rawId}\`. Please check and try again.` });
            return true;
        }

        await showReminderOptions(interaction, day, timeVal, shiftType, coHostUser.id, coHostUser.tag);
        return true;
    }

    // ── Reminder preference ───────────────────────────────────────────────────
    if (id.startsWith('sched_reminder_')) {
        // Format: sched_reminder_{rtype}_{day}_{ti}_{si}_{coHostId|none}
        const parts        = id.replace('sched_reminder_', '').split('_');
        const reminderType = parts[0]; // '24h', '12h', or '10min'
        const day          = parts[1];
        const timeVal      = timeFromIndex(parseInt(parts[2], 10));
        const shiftType    = shiftFromIndex(parseInt(parts[3], 10));
        const coHostId     = parts[4] === 'none' ? null : parts[4];
        if (!timeVal || !shiftType) return false;

        await interaction.deferUpdate().catch(() => {});
        await submitSessionClaim(interaction, client, day, timeVal, shiftType, coHostId, reminderType);
        return true;
    }

    // ── Manage my sessions ────────────────────────────────────────────────────
    if (id === 'sched_manage') {
        await interaction.deferReply({ flags: 64 }).catch(() => {});

        const weekStart = getCurrentWeekStart();
        const mySessions = await Session.find({
            hostId: interaction.user.id,
            weekStart,
            status: { $in: ['pending', 'approved', 'active'] }
        }).sort({ scheduledDay: 1 });

        if (mySessions.length === 0) {
            await interaction.editReply({ content: '📋 You have no sessions claimed this week.' });
            return true;
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Your Sessions This Week')
            .setColor(0x5865F2)
            .setDescription(mySessions.map((s, i) => {
                const statusIcon = s.status === 'approved' ? '✅ Approved' : '🕐 Pending';
                const timeShort  = s.time.split('|')[0].trim();
                const cohost     = s.coHostId ? ` • Co-host: <@${s.coHostId}>` : '';
                return `**${i + 1}.** ${s.scheduledDay} — \`${timeShort}\` — ${s.shiftType}\n　　${statusIcon}${cohost}`;
            }).join('\n\n'))
            .setFooter({ text: `${mySessions.length}/${MAX_SESSIONS_PER_WEEK} sessions this week` });

        // Cancel buttons (one per session, up to 5 per row limit)
        const rows = [];
        let row = new ActionRowBuilder();
        for (let i = 0; i < mySessions.length; i++) {
            if (i > 0 && i % 5 === 0) {
                rows.push(row);
                row = new ActionRowBuilder();
            }
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`sched_cancel_${mySessions[i]._id}`)
                    .setLabel(`Cancel #${i + 1} (${mySessions[i].scheduledDay})`)
                    .setStyle(ButtonStyle.Danger)
            );
        }
        rows.push(row);

        // Add another slot button if under cap
        if (mySessions.length < MAX_SESSIONS_PER_WEEK) {
            const addRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('sched_addmore')
                    .setLabel('➕ Claim Another Slot')
                    .setStyle(ButtonStyle.Success)
            );
            rows.push(addRow);
        }

        await interaction.editReply({ embeds: [embed], components: rows.slice(0, 5) });
        return true;
    }

    // ── Cancel a specific session ─────────────────────────────────────────────
    if (id.startsWith('sched_cancel_')) {
        const sessionId = id.replace('sched_cancel_', '');
        await interaction.deferUpdate().catch(() => {});

        const session = await Session.findById(sessionId);
        if (!session) {
            await interaction.editReply({ content: '❌ Session not found.', components: [] });
            return true;
        }
        if (session.hostId !== interaction.user.id) {
            await interaction.editReply({ content: '❌ You can only cancel your own sessions.', components: [] });
            return true;
        }

        await Session.findByIdAndUpdate(sessionId, { status: 'cancelled' });

        // Notify staff in request channel
        try {
            const channel = await client.channels.fetch(REQUEST_CHANNEL_ID);
            const timeShort = session.time.split('|')[0].trim();
            await channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Session Cancelled')
                    .setColor(0xe74c3c)
                    .setDescription(`<@${interaction.user.id}> cancelled their **${session.scheduledDay}** session at \`${timeShort}\`.`)
                    .setTimestamp()
                ]
            });
        } catch {}

        await refreshSchedule(client);

        await interaction.editReply({
            content: `✅ Your **${session.scheduledDay}** session has been cancelled.`,
            embeds: [],
            components: []
        });
        return true;
    }

    // ── Add more slot shortcut ────────────────────────────────────────────────
    if (id === 'sched_addmore') {
        await interaction.deferUpdate().catch(() => {});
        // Re-show the available days
        const rows = buildDayButtons();
        await interaction.editReply({
            content: '**📅 Claim another slot** — select a day:',
            embeds: [],
            components: rows
        });
        return true;
    }

    // ── Staff: accept session ─────────────────────────────────────────────────
    if (id.startsWith('sesaccept_')) {
        // Handled by existing index.js code — not ours
        return false;
    }

    return false;
}

// ─── Helper: get available times for a day (excluding taken/pending) ──────────
async function getAvailableTimesForDay(day, weekStart) {
    const taken = await Session.find({
        scheduledDay: day,
        weekStart,
        status: { $in: ['pending', 'approved', 'active'] }
    });
    const takenValues = new Set(taken.map(s => s.time));
    return SHIFT_TIMES.filter(t => !takenValues.has(t.value));
}

// ─── Helper: show reminder preference buttons ─────────────────────────────────
// ID format: sched_reminder_{rtype}_{day}_{ti}_{si}_{coHostId|none}
// Max example: sched_reminder_10min_Wednesday_11_1_123456789012345678 = 60 chars ✓
async function showReminderOptions(interaction, day, timeVal, shiftType, coHostId, coHostTag) {
    const ti  = timeIndex(timeVal);
    const si  = shiftIndex(shiftType);
    const ch  = coHostId || 'none';
    const coHostLine = coHostId ? `\n👥 Co-host: **${coHostTag || coHostId}**` : '';

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`sched_reminder_24h_${day}_${ti}_${si}_${ch}`)
            .setLabel('🔔 Remind me 24 hrs before')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`sched_reminder_12h_${day}_${ti}_${si}_${ch}`)
            .setLabel('🔔 Remind me 12 hrs before')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`sched_reminder_10min_${day}_${ti}_${si}_${ch}`)
            .setLabel('⏰ 10 min before only')
            .setStyle(ButtonStyle.Secondary)
    );

    const content =
        `**📅 ${day} — \`${timeVal.split('|')[0].trim()}\` — ${shiftType}**${coHostLine}\n\n` +
        `When would you like to be reminded?`;

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, components: [row] });
    } else {
        await interaction.update({ content, components: [row] });
    }
}

// ─── Helper: actually create the session in DB and notify staff ───────────────
async function submitSessionClaim(interaction, client, day, timeVal, shiftType, coHostId, reminderType) {
    const weekStart = getCurrentWeekStart();

    // Final race-condition check
    const stillTaken = await Session.findOne({
        scheduledDay: day,
        time: timeVal,
        weekStart,
        status: { $in: ['pending', 'approved', 'active'] }
    });
    if (stillTaken) {
        await interaction.editReply({
            content: '❌ That slot was just taken by someone else! Please go back and pick another time.',
            components: []
        });
        return;
    }

    // Calculate when session fires
    const targetDate = getDateForDayThisWeek(day);
    const sessionFireAt = parseSessionTimeOnDate(timeVal, targetDate);

    const session = new Session({
        hostId:                interaction.user.id,
        coHostId:              coHostId || null,
        shiftType,
        time:                  timeVal,
        scheduledDay:          day,
        weekStart,
        requestChannelId:      SCHEDULE_CHANNEL_ID,
        status:                'pending',
        reminderType,
        preSessionReminderSent: false,
        sessionStarted:        false,
        finishCheckStarted:    false,
        hostConfirmed:         false,
        createdAt:             new Date(),
        sessionFireAt,
        autoDeleteAt:          null
    });

    await session.save();

    // Post approval request to channel
    const timeShort  = timeVal.split('|')[0].trim();
    const cohostText = coHostId ? `<@${coHostId}>` : '*None*';

    const approvalEmbed = new EmbedBuilder()
        .setTitle('📋 Session Request')
        .setColor(0x3498DB)
        .addFields(
            { name: '👤 Host',       value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
            { name: '📅 Day',        value: day,        inline: true },
            { name: '🕒 Time',       value: timeShort,  inline: true },
            { name: '🎯 Shift Type', value: shiftType,  inline: true },
            { name: '🤝 Co-Host',    value: cohostText, inline: true },
            { name: '🔔 Reminder',   value: reminderType === '24h' ? '24 hours before' : reminderType === '12h' ? '12 hours before' : '10 minutes before', inline: true }
        )
        .setFooter({ text: `Session ID: ${session._id} • Kavià Café` })
        .setTimestamp();

    const approvalRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`sesaccept_${session._id}`)
            .setLabel('✅ Accept')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`sesdecline_${session._id}`)
            .setLabel('❌ Decline')
            .setStyle(ButtonStyle.Danger)
    );

    try {
        const channel = await client.channels.fetch(REQUEST_CHANNEL_ID);
        const msg = await channel.send({
            content: `<@&${PING_ROLE_ID}>`,
            embeds: [approvalEmbed],
            components: [approvalRow]
        });
        await Session.findByIdAndUpdate(session._id, { requestMessageId: msg.id, requestChannelId: REQUEST_CHANNEL_ID });
    } catch (err) {
        console.error('[sesschedule] Failed to post approval request:', err);
    }

    // Refresh the schedule embed
    await refreshSchedule(client);

    // Confirm to user
    const reminderNote = reminderType === '24h'
        ? "You'll receive a DM reminder **24 hours** before your session."
        : reminderType === '12h'
        ? "You'll receive a DM reminder **12 hours** before your session."
        : "You'll receive a reminder **10 minutes** before your session.";

    await interaction.editReply({
        content:
            `✅ **Session claimed!**\n\n` +
            `📅 **${day}** — \`${timeShort}\` — ${shiftType}\n` +
            (coHostId ? `👥 Co-host: <@${coHostId}>\n` : '') +
            `\n${reminderNote}\n\n` +
            `⏳ Waiting for staff approval — you'll be notified once it's reviewed.`,
        components: []
    });
}

// ─── Parse a time string on a specific UTC date (not "today or tomorrow") ─────
function parseSessionTimeOnDate(timeStr, targetDateUTC) {
    const estPart   = timeStr.split('|')[0].trim();
    const cleanTime = estPart.replace('EST', '').replace('EDT', '').trim();
    const [time, period] = cleanTime.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const result = new Date(Date.UTC(
        targetDateUTC.getUTCFullYear(),
        targetDateUTC.getUTCMonth(),
        targetDateUTC.getUTCDate(),
        hours + getEasternOffsetHours(targetDateUTC),
        minutes, 0, 0
    ));
    return result;
}

// ─── Reminder dispatcher (call from your session scheduler in index.js) ───────
// Called when checking sessions — sends 24h or 12h DM reminders
async function checkAndSendReminders(client) {
    const now = new Date();
    const sessions = await Session.find({
        status: 'approved',
        preSessionReminderSent: false,
        sessionFireAt: { $exists: true }
    });

    for (const s of sessions) {
        if (!s.sessionFireAt) continue;
        const msUntil = s.sessionFireAt.getTime() - now.getTime();
        const hrsUntil = msUntil / 3600000;

        const shouldSend =
            (s.reminderType === '24h'   && hrsUntil <= 24  && hrsUntil > 23) ||
            (s.reminderType === '12h'   && hrsUntil <= 12  && hrsUntil > 11) ||
            (s.reminderType === '10min' && hrsUntil <= (10/60) && hrsUntil > 0);

        if (!shouldSend) continue;

        try {
            const host = await client.users.fetch(s.hostId);
            const timeShort = s.time.split('|')[0].trim();
            const label = s.reminderType === '24h' ? '24 hours' : s.reminderType === '12h' ? '12 hours' : '10 minutes';
            await host.send({
                embeds: [new EmbedBuilder()
                    .setTitle('⏰ Session Reminder')
                    .setColor(0xF39C12)
                    .setDescription(
                        `Your **${s.shiftType}** is starting in **${label}**!\n\n` +
                        `📅 **${s.scheduledDay}** — \`${timeShort}\``
                    )
                    .setTimestamp()
                ]
            });
            await Session.findByIdAndUpdate(s._id, { preSessionReminderSent: true });
        } catch (err) {
            console.error(`[sesschedule] Failed to send reminder for session ${s._id}:`, err.message);
        }
    }
}

// ─── Init: call from client.once('ready') ────────────────────────────────────
async function initScheduleSystem(client) {
    try {
        const weekStart = getCurrentWeekStart();

        // Recover persisted message ID for this week
        const record = await SchedulePost.findById('singleton');
        if (record && record.weekStart === weekStart && record.messageId) {
            // Verify the message still exists in Discord
            try {
                const channel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
                await channel.messages.fetch(record.messageId);
                // Message exists — reuse it, just refresh the embed content
                currentScheduleMessageId = record.messageId;
                currentWeekStart = weekStart;
                console.log(`[sesschedule] Recovered existing schedule post ${record.messageId} (week ${weekStart})`);
                await postWeeklySchedule(client, false); // edit in place, no new post
            } catch {
                // Message was deleted — post a fresh one
                currentScheduleMessageId = null;
                await postWeeklySchedule(client, true);
            }
        } else {
            // Different week or no record — post fresh
            await postWeeklySchedule(client, true);
        }

        // Start Sunday reset timer
        scheduleSundayReset(client);

        console.log('✅ Session schedule system initialised');
    } catch (err) {
        console.error('[sesschedule] Init error:', err);
    }
}

module.exports = {
    initScheduleSystem,
    handleScheduleInteraction,
    checkAndSendReminders,
    postWeeklySchedule,
    refreshSchedule,
    // Re-export constants used by index.js session scheduler
    ANNOUNCEMENT_CHANNEL_ID,
    ANNOUNCEMENT_GUILD_ID,
    SHIFT_PING_ROLE_ID,
    TRAINING_PING_ROLE_ID,
    parseSessionTime,
};