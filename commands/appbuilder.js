/**
 * appbuilder.js — Unified application form management
 *
 * All subcommands previously in /application are merged here.
 *
 * Subcommands:
 *   /appbuilder create <name>          — Build a new form's questions via DM, then setup wizard
 *   /appbuilder edit <form_search>     — Edit an existing form's questions via DM
 *   /appbuilder setup <form_search>    — Configure log/ticket channels for a form
 *   /appbuilder open <form_search>     — Post the Apply button for a form
 *   /appbuilder close <form_search>    — Close a form (remove Apply button)
 *   /appbuilder list                   — List all forms
 *   /appbuilder delete <form_search>   — Delete a form
 *   /appbuilder setclosedate           — Set/clear auto-close date on an open form
 *   /appbuilder statusboard            — Post/update the status board
 *   /appbuilder send <form_search>     — Resend Apply button for already-open form
 */

'use strict';

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits
} = require('discord.js');

// ─── In-memory sessions ───────────────────────────────────────────────────────
const builderSessions  = new Map(); // userId → builder wizard session
const pendingSetups    = new Map(); // userId → setup wizard session
const pendingOpens     = new Map(); // userId → open wizard session
const pendingCloses    = new Map(); // userId → close wizard session

// ─── Helper builders ──────────────────────────────────────────────────────────

function builderEmbed(title, desc, color = 0x5865f2) {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
}

function questionPreviewText(q, index) {
    const num = index + 1;
    const type = q.type === 'scale'  ? '🔢 Scale (1–10)'
               : q.type === 'choice' ? `🔘 Choice (${(q.choices || []).join(' | ')})`
               : '💬 Text';
    const minWords = q.minWords ? `\n> 📏 Min words: **${q.minWords}**` : '';
    const hint     = q.hint     ? `\n> 💡 Hint: *${q.hint}*`           : '';
    const req      = q.required ? '' : '\n> *(optional)*';
    return `**Q${num}.** ${q.text}\n> ${type}${minWords}${hint}${req}`;
}

function fullPreviewEmbed(session) {
    const lines = session.questions.map((q, i) => questionPreviewText(q, i));
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📋 Preview — ${session.formName}`)
        .setDescription(lines.join('\n\n') || '*No questions yet.*')
        .setFooter({ text: `${session.questions.length} question${session.questions.length !== 1 ? 's' : ''}` });
}

/** Build guild select options from the guilds the bot is in */
function guildOptions(client) {
    return client.guilds.cache.map(g => ({ label: g.name.slice(0, 100), value: g.id })).slice(0, 25);
}

/** Build channel options for a given guild (text channels only) */
async function channelOptions(client, guildId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return [];
    const channels = guild.channels.cache.filter(c => c.isTextBased && c.isTextBased() && !c.isVoiceBased());
    return [...channels.values()]
        .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
        .map(c => ({ label: `#${c.name}`.slice(0, 100), value: c.id }))
        .slice(0, 25);
}

/** Create the "type a channel ID" button */
function manualIdButton(customId, label = '✏️ Enter channel ID manually') {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary);
}

/** Render a step embed for the setup wizard */
function stepEmbed(title, desc) {
    return new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(desc);
}

/** Parse a question string with legacy [SCALE] / [CHOICE: ...] prefixes */
function parseQuestion(raw) {
    if (typeof raw === 'object' && raw !== null) return { type: raw.type || 'text', display: raw.text || '', choices: raw.choices || [] };
    if (typeof raw !== 'string') return { type: 'text', display: String(raw), choices: [] };
    if (raw.startsWith('[SCALE]')) return { type: 'scale', display: raw.slice(7).trim(), choices: [] };
    const choiceMatch = raw.match(/^\[CHOICE:\s*([^\]]+)\]/i);
    if (choiceMatch) {
        const choices = choiceMatch[1].split('|').map(s => s.trim()).filter(Boolean);
        return { type: 'choice', display: raw.slice(choiceMatch[0].length).trim(), choices };
    }
    return { type: 'text', display: raw, choices: [] };
}

// ─── Setup wizard step renderer ───────────────────────────────────────────────

async function sendSetupStep(interaction, session, client, isUpdate = false) {
    const { step } = session;
    let embed, components = [];

    if (step === 'log_server') {
        embed = stepEmbed('⚙️ Setup — Step 1/5: Log Server', 'Select the **server** where application logs should be posted.');
        const opts = guildOptions(client);
        if (opts.length) {
            components = [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_log_server_${interaction.user.id}`).setPlaceholder('Select a server').addOptions(opts)
            )];
        } else {
            components = [new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_log_server_${interaction.user.id}`))];
        }
    } else if (step === 'log_channel') {
        embed = stepEmbed('⚙️ Setup — Step 2/5: Log Channel', `Server: **${session.logServerName}**\n\nSelect the **channel** for application logs.`);
        const opts = await channelOptions(client, session.logServerId);
        const rows = [];
        if (opts.length) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_log_channel_${interaction.user.id}`).setPlaceholder('Select a channel').addOptions(opts)
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_log_channel_${interaction.user.id}`)));
        components = rows;
    } else if (step === 'ticket_server') {
        embed = stepEmbed('⚙️ Setup — Step 3/5: Ticket Server', 'Select the **server** where the support ticket channel is.');
        const opts = guildOptions(client);
        if (opts.length) {
            components = [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_ticket_server_${interaction.user.id}`).setPlaceholder('Select a server').addOptions(opts)
            )];
        } else {
            components = [new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_ticket_server_${interaction.user.id}`))];
        }
    } else if (step === 'ticket_channel') {
        embed = stepEmbed('⚙️ Setup — Step 4/5: Ticket Channel', `Server: **${session.ticketServerName}**\n\nSelect the **support ticket channel**.`);
        const opts = await channelOptions(client, session.ticketServerId);
        const rows = [];
        if (opts.length) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_ticket_channel_${interaction.user.id}`).setPlaceholder('Select a channel').addOptions(opts)
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_ticket_channel_${interaction.user.id}`)));
        components = rows;
    } else if (step === 'notify_role') {
        embed = stepEmbed('⚙️ Setup — Step 5/5: Notify Role', 'Enter the **role ID** to ping when a new application comes in.\n\nSend `skip` to use the default role.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`absetup_role_modal_${interaction.user.id}`).setLabel('Enter Role ID').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`absetup_role_skip_${interaction.user.id}`).setLabel('Skip (use default)').setStyle(ButtonStyle.Secondary)
        )];
    } else if (step === 'details') {
        embed = stepEmbed('⚙️ Setup — Form Details', 'Fill in the department, description, and optional Roblox game link for this form.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`absetup_details_modal_${interaction.user.id}`).setLabel('Fill in details').setStyle(ButtonStyle.Primary)
        )];
    }

    const payload = { embeds: [embed], components };
    if (isUpdate) {
        if (interaction.deferred) return interaction.editReply(payload);
        return interaction.update(payload);
    }
    if (interaction.deferred) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp({ ...payload, flags: 64 });
    return interaction.reply({ ...payload, flags: 64 });
}

// ─── Open wizard step renderer ────────────────────────────────────────────────

async function sendOpenStep(interaction, session, client, isUpdate = false) {
    const { step } = session;
    let embed, components = [];

    if (step === 'pick_form') {
        const { AppForm } = require('../db');
        const forms = await AppForm.find({ open: false }).sort({ name: 1 });
        if (!forms.length) {
            const payload = { content: '✅ No closed forms — nothing to open!', embeds: [], components: [] };
            if (isUpdate) return interaction.deferred ? interaction.editReply(payload) : interaction.update(payload);
            return interaction.reply({ ...payload, flags: 64 });
        }
        embed = stepEmbed('📂 Open Form — Step 1: Pick a Form', 'Which form do you want to open?');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`abopen_pick_form_${interaction.user.id}`)
                .setPlaceholder('Select a form')
                .addOptions(forms.map(f => ({ label: f.name.slice(0, 100), value: String(f._id) })).slice(0, 25))
        )];
    } else if (step === 'pick_apply_type') {
        embed = stepEmbed('📂 Open Form — Step 2: Apply Type', `Form: **${session.formName}**\n\nHow should applicants apply?`);
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`abopen_type_dm_${interaction.user.id}`).setLabel('📬 Bot DM (default)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`abopen_type_redirect_${interaction.user.id}`).setLabel('📋 Redirect to channel').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`abopen_type_game_${interaction.user.id}`).setLabel('🎮 Roblox game link').setStyle(ButtonStyle.Secondary)
        )];
    } else if (step === 'pick_redirect_channel') {
        embed = stepEmbed('📂 Open Form — Redirect Channel', `Select the **channel** to redirect applicants to, or enter its ID.`);
        const opts = session.redirectServerId ? await channelOptions(client, session.redirectServerId) : [];
        const rows = [];
        if (opts.length) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`abopen_redirect_channel_${interaction.user.id}`).setPlaceholder('Select channel').addOptions(opts)
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(manualIdButton(`abopen_manual_redirect_${interaction.user.id}`, '✏️ Enter channel ID')));
        components = rows;
    } else if (step === 'pick_close_date') {
        embed = stepEmbed('📂 Open Form — Step 3: Close Date', `Form: **${session.formName}**\n\nShould this form auto-close at a specific date and time?`);
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`abopen_closedate_set_${interaction.user.id}`).setLabel('📅 Set a close date').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`abopen_closedate_skip_${interaction.user.id}`).setLabel('⏭️ No close date').setStyle(ButtonStyle.Secondary)
        )];
    } else if (step === 'pick_server') {
        embed = stepEmbed('📂 Open Form — Step 4: Post Server', 'Which server should the Apply button be posted in?');
        const opts = guildOptions(client);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`abopen_server_${interaction.user.id}`).setPlaceholder('Select server').addOptions(opts)
        )];
    } else if (step === 'pick_channel') {
        embed = stepEmbed('📂 Open Form — Step 5: Post Channel', `Server: **${session.postServerName || '—'}**\n\nWhich channel should the Apply button be posted in?`);
        const opts = session.postServerId ? await channelOptions(client, session.postServerId) : [];
        const rows = [];
        if (opts.length) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`abopen_channel_${interaction.user.id}`).setPlaceholder('Select channel').addOptions(opts)
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(
            manualIdButton(`abopen_manual_channel_${interaction.user.id}`),
            new ButtonBuilder().setCustomId(`abopen_attach_msg_${interaction.user.id}`).setLabel('📌 Attach to existing message').setStyle(ButtonStyle.Secondary)
        ));
        components = rows;
    }

    const payload = { embeds: [embed], components };
    if (isUpdate) {
        return interaction.deferred ? interaction.editReply(payload) : interaction.update(payload);
    }
    if (interaction.deferred) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp({ ...payload, flags: 64 });
    return interaction.reply({ ...payload, flags: 64 });
}

// ─── Close wizard step renderer ───────────────────────────────────────────────

async function sendCloseStep(interaction, session, client, isUpdate = false) {
    const { step } = session;
    let embed, components = [];

    if (step === 'pick_form') {
        const { AppForm } = require('../db');
        const forms = await AppForm.find({ open: true }).sort({ name: 1 });
        if (!forms.length) {
            const payload = { content: '✅ No open forms to close!', embeds: [], components: [] };
            if (isUpdate) return interaction.deferred ? interaction.editReply(payload) : interaction.update(payload);
            return interaction.reply({ ...payload, flags: 64 });
        }
        embed = stepEmbed('🔒 Close Form — Pick a Form', 'Which form do you want to close?');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`abclose_pick_form_${interaction.user.id}`)
                .setPlaceholder('Select a form')
                .addOptions(forms.map(f => ({ label: f.name.slice(0, 100), value: String(f._id) })).slice(0, 25))
        )];
    }

    const payload = { embeds: [embed], components };
    if (isUpdate) {
        return interaction.deferred ? interaction.editReply(payload) : interaction.update(payload);
    }
    if (interaction.deferred) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp({ ...payload, flags: 64 });
    return interaction.reply({ ...payload, flags: 64 });
}

// ─── Status board refresh ─────────────────────────────────────────────────────

async function refreshStatusBoard(client) {
    try {
        const { AppForm, AppStatusBoard } = require('../db');
        const boards = await AppStatusBoard.find();
        if (!boards.length) return;
        const forms = await AppForm.find().sort({ department: 1, name: 1 });

        const descSections = [];

        // Hardcoded barista entry
        descSections.push('**Barista**\n> 📋 Apply via the Interview Center — always open!');

        const byDept = {};
        for (const f of forms) {
            const dept = f.department || 'General';
            if (!byDept[dept]) byDept[dept] = [];
            byDept[dept].push(f);
        }
        for (const [dept, dForms] of Object.entries(byDept)) {
            const lines = dForms.map(f => `> ${f.open ? '🟢' : '🔴'} **${f.name}** — ${f.open ? 'Open' : 'Closed'}`);
            descSections.push(`**${dept}**\n${lines.join('\n')}`);
        }

        const embed = new EmbedBuilder()
            .setTitle('Kavia Applications')
            .setDescription(
                'Here you can find all Kavià Café applications, along with their current status — whether they are open or closed.\n\n' +
                'Start your journey with Kavià Café today!\n\n' +
                descSections.join('\n\n') +
                '\n\n—\nIf you have any questions about your application or once you have submitted one, please open a support ticket in <#1370946382550011925> to get your results.\n\nWe look forward to our future applicants!'
            )
            .setColor(0x5865f2)
            .setThumbnail('https://cdn.discordapp.com/attachments/1420962537096351836/1428133141377187940/kaviacafe_single.png')
            .setImage('https://cdn.discordapp.com/attachments/1420962537096351836/1428133980720463942/kaviastaff_logo21.png')
            .setFooter({ text: 'Last updated' })
            .setTimestamp();

        const components = [];
        const deptButtons = new Map();
        deptButtons.set('Barista', [
            new ButtonBuilder()
                .setURL('https://www.roblox.com/games/88140934632053/Kavia-Cafe-Interview-Center')
                .setLabel('Join Interview Center — Barista')
                .setStyle(ButtonStyle.Link)
        ]);
        for (const f of forms) {
            const dept = f.department || 'General';
            if (!deptButtons.has(dept)) deptButtons.set(dept, []);
            let btn;
            if (f.open) {
                if (f.gameLink) {
                    btn = new ButtonBuilder().setURL(f.gameLink).setLabel(`Apply — ${f.name}`).setStyle(ButtonStyle.Link);
                } else if (f.redirectChannelId) {
                    let guildId = '';
                    try {
                        const postCh = await client.channels.fetch(f.openChannelId).catch(() => null);
                        guildId = postCh?.guildId || '';
                    } catch {}
                    btn = new ButtonBuilder()
                        .setURL(`https://discord.com/channels/${guildId}/${f.redirectChannelId}`)
                        .setLabel(`Apply — ${f.name}`)
                        .setStyle(ButtonStyle.Link);
                } else {
                    btn = new ButtonBuilder()
                        .setCustomId(`app_apply_${f._id}`)
                        .setLabel(`Apply — ${f.name}`)
                        .setStyle(ButtonStyle.Success);
                }
            } else {
                btn = new ButtonBuilder()
                    .setCustomId(`app_closed_${f._id}`)
                    .setLabel(`${f.name} — Closed`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
            }
            deptButtons.get(dept).push(btn);
        }
        for (const [, buttons] of deptButtons) {
            for (let i = 0; i < buttons.length && components.length < 5; i += 5) {
                components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }
        }

        for (const board of boards) {
            try {
                const ch  = await client.channels.fetch(board.channelId).catch(() => null);
                if (!ch) continue;
                const msg = await ch.messages.fetch(board.messageId).catch(() => null);
                if (!msg) continue;
                await msg.edit({ embeds: [embed], components });
                const { AppStatusBoard } = require('../db');
                await AppStatusBoard.findByIdAndUpdate(board._id, { updatedAt: new Date() });
            } catch (err) {
                console.error('[statusboard refresh error]', err);
            }
        }
    } catch (err) {
        console.error('[refreshStatusBoard error]', err);
    }
}

// ─── Save form (after setup wizard completes) ─────────────────────────────────

async function saveFormSetup(dmChannel, userId, session) {
    const { AppForm } = require('../db');
    pendingSetups.delete(userId);

    const questions = session.questions || [];

    if (!session.gameLink && questions.length < 2) {
        return dmChannel.send({ content: '❌ Need at least 2 questions. The form was **not** saved.', embeds: [] });
    }

    let form;
    if (session.formId) {
        // Update existing form with setup details
        form = await AppForm.findByIdAndUpdate(session.formId, {
            logServerId: session.logServerId,       logServerName: session.logServerName,
            logChannelId: session.logChannelId,     logChannelName: session.logChannelName,
            ticketServerId: session.ticketServerId,  ticketServerName: session.ticketServerName,
            ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
            notifyRoleId: session.notifyRoleId || '1480839573390233702',
            department: session.department || 'General',
            description: session.description || '',
            gameLink: session.gameLink || null
        }, { new: true });
    } else {
        form = await AppForm.create({
            name: session.name || session.formName,
            description: session.description || '',
            department: session.department || 'General',
            gameLink: session.gameLink || null,
            questions,
            createdBy: userId,
            logServerId: session.logServerId, logServerName: session.logServerName,
            logChannelId: session.logChannelId, logChannelName: session.logChannelName,
            ticketServerId: session.ticketServerId, ticketServerName: session.ticketServerName,
            ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
            notifyRoleId: session.notifyRoleId || '1480839573390233702',
            createdAt: new Date(), open: false
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('✅ Application Form Saved')
        .setColor(0x57f287)
        .addFields(
            { name: 'Form Name',      value: form.name,                                                 inline: true },
            { name: 'Department',     value: form.department || 'General',                              inline: true },
            { name: 'Questions',      value: `${questions.length}`,                                     inline: true },
            { name: 'Log Channel',    value: `#${form.logChannelName} in **${form.logServerName}**`,   inline: true },
            { name: 'Ticket Channel', value: `#${form.ticketChannelName} in **${form.ticketServerName}**`, inline: true },
            { name: 'Notify Role',    value: `<@&${form.notifyRoleId}>`,                               inline: true }
        )
        .setFooter({ text: 'Use /appbuilder open to post the Apply button' });

    await dmChannel.send({ embeds: [embed] });
    return form;
}

// ─── Finish open (post Apply button) ─────────────────────────────────────────

async function finishOpen(interaction, session, channelId, client, isDeferred = false) {
    const { AppForm } = require('../db');
    pendingOpens.delete(interaction.user.id);

    const replyOrUpdate = (payload) => {
        if (isDeferred) return interaction.editReply(payload);
        if (interaction.isModalSubmit()) return interaction.reply({ ...payload, flags: 64 });
        return interaction.update(payload);
    };

    const targetChannel = await client.channels.fetch(channelId).catch(() => null);
    if (!targetChannel) {
        return replyOrUpdate({ content: `❌ Couldn't find channel \`${channelId}\`. Make sure the ID is correct and the bot is in that server.`, embeds: [], components: [] });
    }

    const isRedirect = !!(session.redirectChannelId && session.redirectChannelId !== 'pending');
    let row;
    if (isRedirect) {
        const redirectCh = await client.channels.fetch(session.redirectChannelId).catch(() => null);
        const chMention  = redirectCh ? `#${redirectCh.name}` : `#${session.redirectChannelName || session.redirectChannelId}`;
        row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setURL(`https://discord.com/channels/${redirectCh?.guildId || targetChannel.guildId}/${session.redirectChannelId}`)
                .setLabel(`📋 Go to ${chMention}`)
                .setStyle(ButtonStyle.Link)
        );
    } else {
        row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`app_apply_${session.formId}`)
                .setLabel('Apply Now 📝')
                .setStyle(ButtonStyle.Primary)
        );
    }

    let openMessageId;
    if (session.messageId) {
        const existing = await targetChannel.messages.fetch(session.messageId).catch(() => null);
        if (!existing) return replyOrUpdate({ content: `❌ Couldn't find message \`${session.messageId}\` in <#${channelId}>.`, embeds: [], components: [] });
        if (existing.author.id !== client.user.id) return replyOrUpdate({ content: `❌ That message wasn't sent by me — I can only add buttons to my own messages.`, embeds: [], components: [] });
        await existing.edit({ components: [row] });
        openMessageId = session.messageId;
    } else {
        const redirectNote = isRedirect ? `\n> 📋 **Head to <#${session.redirectChannelId}> to apply!**` : '\n> Click below to apply. Make sure your DMs are open!';
        const msg = await targetChannel.send({
            content: `> 📝 **${session.formName}**${session.formDesc ? ` — ${session.formDesc}` : ''}${redirectNote}`,
            components: [row]
        });
        openMessageId = msg.id;
    }

    await AppForm.findByIdAndUpdate(session.formId, {
        open: true, openMessageId, openChannelId: channelId,
        redirectChannelId: session.redirectChannelId || null,
        redirectChannelName: session.redirectChannelName || null,
        openedById: interaction.user.id,
        openedByTag: interaction.user.tag,
        closeAt: session.closeAt || null,
        closeWarningDmSent: false
    });
    await refreshStatusBoard(client);

    const closeDateNote = session.closeAt
        ? `\n📅 Auto-closes <t:${Math.floor(session.closeAt.getTime() / 1000)}:F> — you'll get a DM 24 hours before.`
        : '';
    const successNote = isRedirect
        ? `✅ **${session.formName}** is now open! Button posted in <#${channelId}> — redirects to <#${session.redirectChannelId}>.${closeDateNote}`
        : `✅ **${session.formName}** is now open! Apply button posted in <#${channelId}>.${closeDateNote}`;
    return replyOrUpdate({ content: successNote, embeds: [], components: [] });
}

// ─── DM step senders (question builder) ───────────────────────────────────────

async function sendGreeting(user, session) {
    const embed = builderEmbed(
        '👋 Welcome to the Application Builder!',
        [
            `You\'re about to build the questions for **${session.formName}**.`,
            '',
            '**Here\'s how it works:**',
            '1. I\'ll ask you to type each question one at a time',
            '2. After each question you\'ll set the type, min word count, and a hint if needed',
            '3. When you\'re done, I\'ll show you a full preview and you can save or make changes',
            '',
            '> You can type **cancel** at any time to stop without saving.',
            '> You can type **done** when you\'ve added all your questions.',
            '',
            'Ready to begin?'
        ].join('\n')
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_start_${user.id}`).setLabel('✅ Let\'s go!').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ab_remind_${user.id}`).setLabel('⏰ Remind me later').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ab_cancel_${user.id}`).setLabel('❌ Never mind').setStyle(ButtonStyle.Danger)
    );

    const dm = await user.createDM();
    return dm.send({ embeds: [embed], components: [row] });
}

async function sendAskQuestion(dmChannel, session) {
    const num = session.questions.length + 1;
    const embed = builderEmbed(
        `➕ Question ${num}`,
        [
            `Type your **Question ${num}** below and send it as a message.`,
            '',
            '**Tips:**',
            '• Keep it clear and concise',
            '• You\'ll be able to set type, min words, and a hint after',
            '',
            'When you\'ve added all questions, type **done**.',
            'Type **cancel** to stop without saving.'
        ].join('\n')
    );
    return dmChannel.send({ embeds: [embed] });
}

async function sendQuestionOptions(dmChannel, userId, questionText) {
    const embed = builderEmbed(
        '✏️ Configure This Question',
        [`**Your question:**`, `> ${questionText}`, '', 'What **type** of answer should this question accept?'].join('\n')
    );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_type_text_${userId}`).setLabel('💬 Text (typed answer)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ab_type_scale_${userId}`).setLabel('🔢 Scale (1–10)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ab_type_choice_${userId}`).setLabel('🔘 Choice (buttons)').setStyle(ButtonStyle.Secondary)
    );
    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendTextOptions(dmChannel, userId, session) {
    const embed = builderEmbed(
        '📏 Text Options',
        [`**Question:** ${session.currentQ.text}`, '', 'Would you like to set a **minimum word count**?', 'This forces applicants to write more than a one-word answer.'].join('\n')
    );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_minwords_set_${userId}`).setLabel('📏 Set min words').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ab_minwords_skip_${userId}`).setLabel('⏭️ No minimum').setStyle(ButtonStyle.Secondary)
    );
    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendHintStep(dmChannel, userId, session) {
    const embed = builderEmbed(
        '💡 Add a Hint (optional)',
        [`**Question:** ${session.currentQ.text}`, '', 'Would you like to add a **hint** shown to applicants under this question?', 'Example: *"Be specific — at least 3 sentences."*'].join('\n')
    );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_hint_set_${userId}`).setLabel('💡 Add hint').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ab_hint_skip_${userId}`).setLabel('⏭️ No hint').setStyle(ButtonStyle.Secondary)
    );
    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendRequiredStep(dmChannel, userId, session) {
    const embed = builderEmbed(
        '❓ Required?',
        [`**Question:** ${session.currentQ.text}`, '', 'Should applicants be **required** to answer this question?'].join('\n')
    );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_req_yes_${userId}`).setLabel('✅ Required').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ab_req_no_${userId}`).setLabel('⏭️ Optional').setStyle(ButtonStyle.Secondary)
    );
    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendQuestionConfirm(dmChannel, userId, session) {
    const q = session.currentQ;
    const embed = builderEmbed(
        '✅ Question Preview',
        [questionPreviewText(q, session.questions.length), '', 'Does this look right?'].join('\n'),
        0x2ecc71
    );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_qconfirm_yes_${userId}`).setLabel('✅ Save this question').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ab_qconfirm_redo_${userId}`).setLabel('🔄 Redo this question').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ab_qconfirm_done_${userId}`).setLabel('🏁 Done — no more questions').setStyle(ButtonStyle.Primary)
    );
    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendFinalPreview(dmChannel, userId, session) {
    const embed = fullPreviewEmbed(session);
    embed.setTitle(`📋 Final Preview — ${session.formName}`);

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ab_save_${userId}`).setLabel('💾 Save & finish').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ab_addmore_${userId}`).setLabel('➕ Add more').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ab_cancel_${userId}`).setLabel('🗑️ Discard').setStyle(ButtonStyle.Danger)
    );

    const components = [buttonRow];

    // Add question-jump dropdown if there are any questions
    if (session.questions.length) {
        const jumpRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`ab_jumpq_${userId}`)
                .setPlaceholder('✏️ Edit a question…')
                .addOptions(session.questions.map((q, i) => ({
                    label: `Q${i + 1}: ${q.text.slice(0, 90)}${q.text.length > 90 ? '…' : ''}`,
                    value: String(i)
                })).slice(0, 25))
        );
        components.push(jumpRow);
    }

    return dmChannel.send({ embeds: [embed], components });
}

// ─── After questions saved — kick off setup wizard in DM ─────────────────────

async function startSetupWizardDM(user, session) {
    const dm = await user.createDM();
    pendingSetups.set(user.id, {
        step: 'log_server',
        formId: session.formId || null,
        formName: session.formName,
        name: session.formName,
        questions: session.questions || []
    });
    await dm.send({
        embeds: [builderEmbed('⚙️ Now let\'s set up the form channels', 'Great work on the questions! Now I need a couple of channel details so applications get routed correctly.\n\nThis won\'t take long — just 5 quick steps.')],
    });

    // We need a fake interaction-like object for sendSetupStep since it expects interaction
    // Instead we'll send directly
    const setupSession = pendingSetups.get(user.id);
    const opts = []; // We'll send the first step as a direct DM
    await dm.send(await buildSetupStepPayload('log_server', setupSession, null));
}

async function buildSetupStepPayload(step, session, client) {
    let embed, components = [];
    if (step === 'log_server') {
        embed = stepEmbed('⚙️ Setup — Step 1/5: Log Server', 'Reply with the **server ID** for application logs, or use the button below.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`absetup_manual_log_server_${session._userId || 'dm'}`).setLabel('✏️ Type server ID').setStyle(ButtonStyle.Primary)
        )];
    }
    return { embeds: [embed], components };
}

// ─── Main interaction handler (all ab_/absetup_/abopen_/abclose_ buttons) ────

async function handleBuilderInteraction(interaction, client) {
    const id = interaction.customId;
    if (!id) return false;

    // ── Question builder (ab_) buttons ────────────────────────────────────────
    if (id.startsWith('ab_')) {
        return handleBuilderButtonInteraction(interaction, client);
    }

    // ── Setup wizard (absetup_) buttons + selects ─────────────────────────────
    if (id.startsWith('absetup_')) {
        return handleSetupInteraction(interaction, client);
    }

    // ── Open wizard (abopen_) buttons + selects ───────────────────────────────
    if (id.startsWith('abopen_')) {
        return handleOpenInteraction(interaction, client);
    }

    // ── Close wizard (abclose_) selects ──────────────────────────────────────
    if (id.startsWith('abclose_')) {
        return handleCloseInteraction(interaction, client);
    }

    // ── Send pick (absend_) selects ───────────────────────────────────────────
    if (id.startsWith('absend_')) {
        return handleSendPick(interaction, client);
    }

    return false;
}

// ─── Question builder button handler ─────────────────────────────────────────

async function handleBuilderButtonInteraction(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;
    const session = builderSessions.get(userId);

    if (id === `ab_start_${userId}`) {
        if (!session) return interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Your builder session expired. Run the command again.')], components: [] });
        await interaction.update({ embeds: [builderEmbed('✅ Let\'s go!', 'Loading your questions…')], components: [] });
        const dm = await interaction.user.createDM();
        if (session.questions.length) {
            // Edit mode — show preview with jump dropdown first
            session.step = 'final_preview';
            await sendFinalPreview(dm, userId, session);
        } else {
            // Create mode — go straight to adding questions
            session.step = 'awaiting_question';
            await sendAskQuestion(dm, session);
        }
        return true;
    }

    if (id === `ab_remind_${userId}`) {
        if (!session) return interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Run the command again.')], components: [] });
        session.remindAt = Date.now() + 60 * 60 * 1000;
        builderSessions.set(userId, session);
        await interaction.update({
            embeds: [builderEmbed('⏰ Reminder Set', 'I\'ll send you a reminder in **1 hour** to come back and build your questions.')],
            components: []
        });
        setTimeout(async () => {
            try {
                const s = builderSessions.get(userId);
                if (!s || s.step !== 'reminded') return;
                await sendGreeting(interaction.user, s);
                s.step = 'greeting';
                builderSessions.set(userId, s);
            } catch {}
        }, 60 * 60 * 1000);
        session.step = 'reminded';
        return true;
    }

    if (id === `ab_cancel_${userId}`) {
        builderSessions.delete(userId);
        await interaction.update({
            embeds: [builderEmbed('❌ Cancelled', 'No changes were saved. Run the command again whenever you\'re ready.', 0xe74c3c)],
            components: []
        });
        return true;
    }

    if (!session) {
        await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Your builder session expired. Run the command again.')], components: [] }).catch(() => {});
        return true;
    }

    if (id === `ab_type_text_${userId}`) {
        session.currentQ.type = 'text';
        await interaction.update({ embeds: [builderEmbed('💬 Text selected', `**Question:** ${session.currentQ.text}\n\nGreat — applicants will type a free-form answer.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendTextOptions(dm, userId, session);
        return true;
    }

    if (id === `ab_type_scale_${userId}`) {
        session.currentQ.type = 'scale';
        session.currentQ.choices = [];
        await interaction.update({ embeds: [builderEmbed('🔢 Scale selected', `**Question:** ${session.currentQ.text}\n\nApplicants will pick a number from 1–10.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    if (id === `ab_type_choice_${userId}`) {
        session.currentQ.type = 'choice';
        session.step = 'awaiting_choices';
        await interaction.update({ embeds: [builderEmbed('🔘 Choice selected', `**Question:** ${session.currentQ.text}\n\nType the choices separated by **|** (pipe).\n\nExample: \`Yes | No | Maybe\``)], components: [] });
        return true;
    }

    if (id === `ab_minwords_set_${userId}`) {
        session.step = 'awaiting_minwords';
        await interaction.update({ embeds: [builderEmbed('📏 Min Words', 'Type the **minimum word count** for this question (e.g. `50`).')], components: [] });
        return true;
    }

    if (id === `ab_minwords_skip_${userId}`) {
        session.currentQ.minWords = null;
        await interaction.update({ embeds: [builderEmbed('⏭️ No minimum', 'No word minimum set.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    if (id === `ab_hint_set_${userId}`) {
        session.step = 'awaiting_hint';
        await interaction.update({ embeds: [builderEmbed('💡 Add Hint', 'Type the hint text to show applicants under this question.')], components: [] });
        return true;
    }

    if (id === `ab_hint_skip_${userId}`) {
        session.currentQ.hint = null;
        await interaction.update({ embeds: [builderEmbed('⏭️ No hint', 'No hint set.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendRequiredStep(dm, userId, session);
        return true;
    }

    if (id === `ab_req_yes_${userId}`) {
        session.currentQ.required = true;
        await interaction.update({ embeds: [builderEmbed('✅ Marked as required', 'Applicants must answer this question.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendQuestionConfirm(dm, userId, session);
        return true;
    }

    if (id === `ab_req_no_${userId}`) {
        session.currentQ.required = false;
        await interaction.update({ embeds: [builderEmbed('⏭️ Optional', 'Applicants may skip this question.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendQuestionConfirm(dm, userId, session);
        return true;
    }

    if (id === `ab_qconfirm_yes_${userId}`) {
        session.questions.push({ ...session.currentQ });
        session.currentQ = {};
        session.step = 'awaiting_question';
        await interaction.update({ embeds: [builderEmbed('✅ Question saved!', `You now have **${session.questions.length}** question${session.questions.length !== 1 ? 's' : ''}.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendAskQuestion(dm, session);
        return true;
    }

    if (id === `ab_qconfirm_redo_${userId}`) {
        session.currentQ = {};
        session.step = 'awaiting_question';
        await interaction.update({ embeds: [builderEmbed('🔄 Let\'s redo that', 'Type your question again below.')], components: [] });
        return true;
    }

    if (id === `ab_qconfirm_done_${userId}`) {
        session.currentQ = {};
        session.step = 'final_preview';
        await interaction.update({ embeds: [builderEmbed('🏁 All done!', 'Here\'s your full preview.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendFinalPreview(dm, userId, session);
        return true;
    }

    if (id === `ab_save_${userId}`) {
        if (!session.questions.length) {
            await interaction.update({ embeds: [builderEmbed('⚠️ No questions', 'Add at least one question before saving.')], components: [] });
            return true;
        }
        try {
            const { AppForm } = require('../db');
            await interaction.deferUpdate();

            if (session.formId) {
                // Edit mode — update questions only
                await AppForm.findByIdAndUpdate(session.formId, { questions: session.questions });
                builderSessions.delete(userId);
                const embed = fullPreviewEmbed(session);
                embed.setTitle(`💾 Saved — ${session.formName}`);
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                // Create mode — save questions to a draft form, then kick off setup wizard
                const form = await AppForm.create({
                    name: session.formName,
                    questions: session.questions,
                    createdBy: userId,
                    logServerId: '', logServerName: '',
                    logChannelId: '', logChannelName: '',
                    ticketServerId: '', ticketServerName: '',
                    ticketChannelId: '', ticketChannelName: '',
                    open: false
                });
                session.formId = String(form._id);
                builderSessions.delete(userId);

                // Transition into setup wizard
                pendingSetups.set(userId, {
                    step: 'log_server',
                    formId: session.formId,
                    formName: session.formName,
                    name: session.formName,
                    questions: session.questions
                });

                const embed = fullPreviewEmbed(session);
                embed.setTitle(`💾 Questions Saved — ${session.formName}`);
                await interaction.editReply({ embeds: [embed], components: [] });

                // Send setup wizard step into DM
                const dm = await interaction.user.createDM();
                await dm.send({ embeds: [builderEmbed('⚙️ Almost done!', 'Questions saved! Now let\'s configure the log and ticket channels.\n\nI\'ll guide you through 5 quick steps right here in DM.')] });
                await sendSetupStepDM(dm, userId, pendingSetups.get(userId), client);
            }
        } catch (err) {
            console.error('[appbuilder save]', err);
            await interaction.editReply({ embeds: [builderEmbed('❌ Error', 'Failed to save. Please try again.', 0xe74c3c)], components: [] }).catch(() => {});
        }
        return true;
    }

    if (id === `ab_addmore_${userId}`) {
        session.step = 'awaiting_question';
        session.currentQ = {};
        await interaction.update({ embeds: [builderEmbed('➕ Adding more', `You have **${session.questions.length}** questions so far. Type your next one below.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendAskQuestion(dm, session);
        return true;
    }

    // ab_jumpq_ is a select menu — handled in handleBuilderInteraction top-level
    // (falls through to false here, caught by isStringSelectMenu branch)

    return false;
}

// ─── DM setup wizard step sender ─────────────────────────────────────────────
// Used after question builder saves, to send setup steps in DM without an interaction

async function sendSetupStepDM(dmChannel, userId, session, client) {
    const { step } = session;
    let embed, components = [];

    if (step === 'log_server') {
        embed = stepEmbed('⚙️ Setup 1/5 — Log Server', 'Which server should application logs be posted in?\n\nReply with the **server ID** or select below.');
        const opts = client ? guildOptions(client) : [];
        if (opts.length) {
            components = [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_log_server_${userId}`).setPlaceholder('Select server').addOptions(opts)
            )];
        } else {
            components = [new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_log_server_${userId}`))];
        }
    } else if (step === 'log_channel') {
        embed = stepEmbed('⚙️ Setup 2/5 — Log Channel', `Server: **${session.logServerName}**\n\nWhich channel should logs go in?`);
        const opts = client ? await channelOptions(client, session.logServerId) : [];
        const rows = [];
        if (opts.length) rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`absetup_log_channel_${userId}`).setPlaceholder('Select channel').addOptions(opts)
        ));
        rows.push(new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_log_channel_${userId}`)));
        components = rows;
    } else if (step === 'ticket_server') {
        embed = stepEmbed('⚙️ Setup 3/5 — Ticket Server', 'Which server has the support ticket channel?');
        const opts = client ? guildOptions(client) : [];
        if (opts.length) {
            components = [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`absetup_ticket_server_${userId}`).setPlaceholder('Select server').addOptions(opts)
            )];
        } else {
            components = [new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_ticket_server_${userId}`))];
        }
    } else if (step === 'ticket_channel') {
        embed = stepEmbed('⚙️ Setup 4/5 — Ticket Channel', `Server: **${session.ticketServerName}**\n\nWhich channel is the support ticket channel?`);
        const opts = client ? await channelOptions(client, session.ticketServerId) : [];
        const rows = [];
        if (opts.length) rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`absetup_ticket_channel_${userId}`).setPlaceholder('Select channel').addOptions(opts)
        ));
        rows.push(new ActionRowBuilder().addComponents(manualIdButton(`absetup_manual_ticket_channel_${userId}`)));
        components = rows;
    } else if (step === 'notify_role') {
        embed = stepEmbed('⚙️ Setup 5/5 — Notify Role', 'What role should be pinged when a new application comes in?\n\nUse the button below or type `skip` to use the default role.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`absetup_role_modal_${userId}`).setLabel('Enter Role ID').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`absetup_role_skip_${userId}`).setLabel('Skip (use default)').setStyle(ButtonStyle.Secondary)
        )];
    } else if (step === 'details') {
        embed = stepEmbed('⚙️ Setup — Form Details', 'Fill in optional details like department and description.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`absetup_details_modal_${userId}`).setLabel('Fill in details').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`absetup_details_skip_${userId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary)
        )];
    }

    return dmChannel.send({ embeds: [embed], components });
}

// ─── Setup wizard interaction handler ────────────────────────────────────────

async function handleSetupInteraction(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;
    const session = pendingSetups.get(userId);

    if (!session) {
        await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Setup session expired. Run `/appbuilder setup` again.')], components: [] }).catch(() => {});
        return true;
    }

    // ── Log server select ─────────────────────────────────────────────────────
    if (id === `absetup_log_server_${userId}`) {
        const guildId = interaction.values[0];
        const guild   = client.guilds.cache.get(guildId);
        session.logServerId   = guildId;
        session.logServerName = guild?.name || guildId;
        session.step = 'log_channel';
        pendingSetups.set(userId, session);
        await interaction.deferUpdate();
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        await interaction.editReply({ embeds: [builderEmbed('✅', `Log server: **${session.logServerName}**`)], components: [] });
        return true;
    }

    if (id === `absetup_manual_log_server_${userId}`) {
        // Show modal for manual ID
        const modal = new ModalBuilder().setCustomId(`absetup_modal_log_server_${userId}`).setTitle('Log Server ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('server_id').setLabel('Server ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_log_server_${userId}`) {
        const guildId = interaction.fields.getTextInputValue('server_id').trim();
        const guild   = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return interaction.reply({ content: `❌ Couldn't find server \`${guildId}\`.`, flags: 64 });
        session.logServerId   = guildId;
        session.logServerName = guild.name;
        session.step = 'log_channel';
        pendingSetups.set(userId, session);
        await interaction.reply({ content: `✅ Log server: **${guild.name}**`, flags: 64 });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    // ── Log channel select ────────────────────────────────────────────────────
    if (id === `absetup_log_channel_${userId}`) {
        const channelId = interaction.values[0];
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        session.logChannelId   = channelId;
        session.logChannelName = ch?.name || channelId;
        session.step = 'ticket_server';
        pendingSetups.set(userId, session);
        await interaction.deferUpdate();
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        await interaction.editReply({ embeds: [builderEmbed('✅', `Log channel: **#${session.logChannelName}**`)], components: [] });
        return true;
    }

    if (id === `absetup_manual_log_channel_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`absetup_modal_log_channel_${userId}`).setTitle('Log Channel ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_log_channel_${userId}`) {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        if (!ch) return interaction.reply({ content: `❌ Couldn't find channel \`${channelId}\`.`, flags: 64 });
        session.logChannelId   = channelId;
        session.logChannelName = ch.name;
        session.step = 'ticket_server';
        pendingSetups.set(userId, session);
        await interaction.reply({ content: `✅ Log channel: **#${ch.name}**`, flags: 64 });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    // ── Ticket server select ──────────────────────────────────────────────────
    if (id === `absetup_ticket_server_${userId}`) {
        const guildId = interaction.values[0];
        const guild   = client.guilds.cache.get(guildId);
        session.ticketServerId   = guildId;
        session.ticketServerName = guild?.name || guildId;
        session.step = 'ticket_channel';
        pendingSetups.set(userId, session);
        await interaction.deferUpdate();
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        await interaction.editReply({ embeds: [builderEmbed('✅', `Ticket server: **${session.ticketServerName}**`)], components: [] });
        return true;
    }

    if (id === `absetup_manual_ticket_server_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`absetup_modal_ticket_server_${userId}`).setTitle('Ticket Server ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('server_id').setLabel('Server ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_ticket_server_${userId}`) {
        const guildId = interaction.fields.getTextInputValue('server_id').trim();
        const guild   = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return interaction.reply({ content: `❌ Couldn't find server \`${guildId}\`.`, flags: 64 });
        session.ticketServerId   = guildId;
        session.ticketServerName = guild.name;
        session.step = 'ticket_channel';
        pendingSetups.set(userId, session);
        await interaction.reply({ content: `✅ Ticket server: **${guild.name}**`, flags: 64 });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    // ── Ticket channel select ─────────────────────────────────────────────────
    if (id === `absetup_ticket_channel_${userId}`) {
        const channelId = interaction.values[0];
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        session.ticketChannelId   = channelId;
        session.ticketChannelName = ch?.name || channelId;
        session.step = 'notify_role';
        pendingSetups.set(userId, session);
        await interaction.deferUpdate();
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        await interaction.editReply({ embeds: [builderEmbed('✅', `Ticket channel: **#${session.ticketChannelName}**`)], components: [] });
        return true;
    }

    if (id === `absetup_manual_ticket_channel_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`absetup_modal_ticket_channel_${userId}`).setTitle('Ticket Channel ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_ticket_channel_${userId}`) {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        if (!ch) return interaction.reply({ content: `❌ Couldn't find channel \`${channelId}\`.`, flags: 64 });
        session.ticketChannelId   = channelId;
        session.ticketChannelName = ch.name;
        session.step = 'notify_role';
        pendingSetups.set(userId, session);
        await interaction.reply({ content: `✅ Ticket channel: **#${ch.name}**`, flags: 64 });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    // ── Notify role ───────────────────────────────────────────────────────────
    if (id === `absetup_role_modal_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`absetup_modal_notify_role_${userId}`).setTitle('Notify Role ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_id').setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_notify_role_${userId}`) {
        const roleId = interaction.fields.getTextInputValue('role_id').trim();
        session.notifyRoleId = roleId;
        session.step = 'details';
        pendingSetups.set(userId, session);
        await interaction.reply({ content: `✅ Notify role set to <@&${roleId}>`, flags: 64 });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    if (id === `absetup_role_skip_${userId}`) {
        session.notifyRoleId = '1480839573390233702'; // default
        session.step = 'details';
        pendingSetups.set(userId, session);
        await interaction.update({ embeds: [builderEmbed('✅ Default role set', 'Using default notify role.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendSetupStepDM(dm, userId, session, client);
        return true;
    }

    // ── Details modal ─────────────────────────────────────────────────────────
    if (id === `absetup_details_modal_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`absetup_modal_details_${userId}`).setTitle('Form Details');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('department').setLabel('Department (e.g. Kitchen, Bar)').setStyle(TextInputStyle.Short).setRequired(false).setValue(session.department || '')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('description').setLabel('Short description (shown in Apply post)').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(session.description || '')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('gameLink').setLabel('Roblox game link (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(session.gameLink || '')
            )
        );
        return interaction.showModal(modal);
    }

    if (id === `absetup_modal_details_${userId}`) {
        session.department  = interaction.fields.getTextInputValue('department').trim()  || 'General';
        session.description = interaction.fields.getTextInputValue('description').trim() || '';
        session.gameLink    = interaction.fields.getTextInputValue('gameLink').trim()    || null;
        pendingSetups.set(userId, session);
        await interaction.reply({ content: '✅ Details saved! Finishing up…', flags: 64 });
        const dm = await interaction.user.createDM();
        await completeSetup(dm, userId, session, client);
        return true;
    }

    if (id === `absetup_details_skip_${userId}`) {
        session.department  = 'General';
        session.description = '';
        session.gameLink    = null;
        await interaction.update({ embeds: [builderEmbed('✅ Skipped', 'Using default department.')], components: [] });
        const dm = await interaction.user.createDM();
        await completeSetup(dm, userId, session, client);
        return true;
    }

    return false;
}

async function completeSetup(dmChannel, userId, session, client) {
    const { AppForm } = require('../db');
    pendingSetups.delete(userId);
    try {
        let form;
        if (session.formId) {
            form = await AppForm.findByIdAndUpdate(session.formId, {
                logServerId: session.logServerId, logServerName: session.logServerName,
                logChannelId: session.logChannelId, logChannelName: session.logChannelName,
                ticketServerId: session.ticketServerId, ticketServerName: session.ticketServerName,
                ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
                notifyRoleId: session.notifyRoleId || '1480839573390233702',
                department: session.department || 'General',
                description: session.description || '',
                gameLink: session.gameLink || null
            }, { new: true });
        } else {
            form = await AppForm.create({
                name: session.name || session.formName,
                description: session.description || '',
                department: session.department || 'General',
                gameLink: session.gameLink || null,
                questions: session.questions || [],
                createdBy: userId,
                logServerId: session.logServerId, logServerName: session.logServerName,
                logChannelId: session.logChannelId, logChannelName: session.logChannelName,
                ticketServerId: session.ticketServerId, ticketServerName: session.ticketServerName,
                ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
                notifyRoleId: session.notifyRoleId || '1480839573390233702',
                createdAt: new Date(), open: false
            });
        }
        const embed = new EmbedBuilder()
            .setTitle('✅ Form Ready!')
            .setColor(0x57f287)
            .addFields(
                { name: 'Form Name',      value: form.name,                                                   inline: true },
                { name: 'Department',     value: form.department || 'General',                                inline: true },
                { name: 'Log Channel',    value: `#${form.logChannelName} in **${form.logServerName}**`,     inline: false },
                { name: 'Ticket Channel', value: `#${form.ticketChannelName} in **${form.ticketServerName}**`, inline: false },
                { name: 'Notify Role',    value: `<@&${form.notifyRoleId}>`,                                 inline: true }
            )
            .setFooter({ text: 'Use /appbuilder open to post the Apply button' });
        await dmChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[appbuilder completeSetup]', err);
        await dmChannel.send({ content: '❌ Failed to save form setup. Please try again.' });
    }
}

// ─── Open wizard interaction handler ─────────────────────────────────────────

async function handleOpenInteraction(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;
    const session = pendingOpens.get(userId);

    if (!session) {
        await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Open session expired. Run `/appbuilder open` again.')], components: [] }).catch(() => {});
        return true;
    }

    if (id === `abopen_pick_form_${userId}`) {
        const { AppForm } = require('../db');
        const form = await AppForm.findById(interaction.values[0]);
        if (!form) return interaction.update({ content: '❌ Form not found.', embeds: [], components: [] });
        session.formId   = String(form._id);
        session.formName = form.name;
        session.formDesc = form.description || '';
        session.step = 'pick_apply_type';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_type_dm_${userId}`) {
        session.redirectChannelId = null;
        session.step = 'pick_close_date';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_type_redirect_${userId}`) {
        session.step = 'pick_redirect_channel';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_type_game_${userId}`) {
        // Show modal for game link
        const modal = new ModalBuilder().setCustomId(`abopen_modal_game_${userId}`).setTitle('Roblox Game Link');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('game_link').setLabel('Paste the Roblox game link').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `abopen_modal_game_${userId}`) {
        session.gameLink = interaction.fields.getTextInputValue('game_link').trim();
        session.step = 'pick_close_date';
        pendingOpens.set(userId, session);
        await interaction.reply({ content: '✅ Game link set!', flags: 64 });
        // Now go to close date
        await sendOpenStep(interaction, session, client, false);
        return true;
    }

    if (id === `abopen_redirect_channel_${userId}`) {
        const channelId = interaction.values[0];
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        session.redirectChannelId   = channelId;
        session.redirectChannelName = ch?.name || channelId;
        session.step = 'pick_close_date';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_manual_redirect_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`abopen_modal_redirect_${userId}`).setTitle('Redirect Channel ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `abopen_modal_redirect_${userId}`) {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        session.redirectChannelId   = channelId;
        session.redirectChannelName = ch?.name || channelId;
        session.step = 'pick_close_date';
        pendingOpens.set(userId, session);
        await interaction.reply({ content: `✅ Redirect channel: **#${session.redirectChannelName}**`, flags: 64 });
        await sendOpenStep(interaction, session, client, false);
        return true;
    }

    if (id === `abopen_closedate_set_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`abopen_modal_closedate_${userId}`).setTitle('Auto-close Date');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('close_date').setLabel('Date & time (YYYY-MM-DD HH:MM UTC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('2025-12-31 23:59')
        ));
        return interaction.showModal(modal);
    }

    if (id === `abopen_modal_closedate_${userId}`) {
        const raw  = interaction.fields.getTextInputValue('close_date').trim();
        const date = new Date(raw.replace(' ', 'T') + (raw.includes('Z') ? '' : 'Z'));
        if (isNaN(date.getTime()) || date <= new Date()) {
            return interaction.reply({ content: '❌ Invalid date or date in the past. Use format: `YYYY-MM-DD HH:MM`', flags: 64 });
        }
        session.closeAt = date;
        session.step = 'pick_server';
        pendingOpens.set(userId, session);
        await interaction.reply({ content: `✅ Auto-close set to <t:${Math.floor(date.getTime() / 1000)}:F>`, flags: 64 });
        await sendOpenStep(interaction, session, client, false);
        return true;
    }

    if (id === `abopen_closedate_skip_${userId}`) {
        session.closeAt = null;
        session.step = 'pick_server';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_server_${userId}`) {
        const guildId = interaction.values[0];
        const guild   = client.guilds.cache.get(guildId);
        session.postServerId   = guildId;
        session.postServerName = guild?.name || guildId;
        session.step = 'pick_channel';
        pendingOpens.set(userId, session);
        await interaction.deferUpdate();
        await sendOpenStep(interaction, session, client, true);
        return true;
    }

    if (id === `abopen_channel_${userId}`) {
        const channelId = interaction.values[0];
        await interaction.deferUpdate();
        await finishOpen(interaction, session, channelId, client, true);
        return true;
    }

    if (id === `abopen_manual_channel_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`abopen_modal_channel_${userId}`).setTitle('Post Channel ID');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `abopen_modal_channel_${userId}`) {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        await finishOpen(interaction, session, channelId, client, false);
        return true;
    }

    if (id === `abopen_attach_msg_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`abopen_modal_attach_${userId}`).setTitle('Attach to Message');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('message_id').setLabel('Message ID (must be my message)').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    if (id === `abopen_modal_attach_${userId}`) {
        const channelId = interaction.fields.getTextInputValue('channel_id').trim();
        const messageId = interaction.fields.getTextInputValue('message_id').trim();
        session.messageId = messageId;
        pendingOpens.set(userId, session);
        await finishOpen(interaction, session, channelId, client, false);
        return true;
    }

    return false;
}

// ─── Close wizard interaction handler ─────────────────────────────────────────

async function handleCloseInteraction(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;
    const session = pendingCloses.get(userId);

    if (!session) {
        await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Close session expired. Run `/appbuilder close` again.')], components: [] }).catch(() => {});
        return true;
    }

    if (id === `abclose_pick_form_${userId}`) {
        const { AppForm } = require('../db');
        const form = await AppForm.findById(interaction.values[0]);
        if (!form) return interaction.update({ content: '❌ Form not found.', embeds: [], components: [] });

        await interaction.deferUpdate();

        // Remove the Apply button from the channel
        if (form.openChannelId && form.openMessageId) {
            try {
                const ch  = await client.channels.fetch(form.openChannelId).catch(() => null);
                const msg = ch ? await ch.messages.fetch(form.openMessageId).catch(() => null) : null;
                if (msg) await msg.edit({ components: [] });
            } catch (err) {
                console.error('[appbuilder close button remove]', err);
            }
        }

        await AppForm.findByIdAndUpdate(form._id, {
            open: false, openMessageId: null, openChannelId: null,
            closedById: userId, closedByTag: interaction.user.tag, closeAt: null
        });
        await refreshStatusBoard(client);
        pendingCloses.delete(userId);
        await interaction.editReply({ content: `🔒 **${form.name}** is now closed. The Apply button has been removed.`, embeds: [], components: [] });
        return true;
    }

    return false;
}

// ─── Send pick handler ────────────────────────────────────────────────────────

async function handleSendPick(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;

    if (!id.startsWith(`absend_pick_form_${userId}`)) return false;

    const { AppForm } = require('../db');
    const formId  = interaction.values[0];
    const form    = await AppForm.findById(formId);
    if (!form || !form.open) return interaction.update({ content: '❌ That form is not currently open.', embeds: [], components: [] });

    // Kick into open wizard at pick_channel step (skipping form pick)
    const session = {
        formId: String(form._id),
        formName: form.name,
        formDesc: form.description || '',
        redirectChannelId: form.redirectChannelId || null,
        redirectChannelName: form.redirectChannelName || null,
        closeAt: null,
        step: 'pick_server'
    };
    pendingOpens.set(userId, session);
    await interaction.deferUpdate();
    await sendOpenStep(interaction, session, client, true);
    return true;
}

// ─── DM message handler ───────────────────────────────────────────────────────

async function handleBuilderMessage(message, client) {
    if (message.author.bot) return false;
    if (message.guild) return false; // DMs only

    const userId  = message.author.id;
    const text    = message.content.trim();

    // ── Question builder session ──────────────────────────────────────────────
    const bSession = builderSessions.get(userId);
    if (bSession) {
        if (text.toLowerCase() === 'cancel') {
            builderSessions.delete(userId);
            await message.reply({ embeds: [builderEmbed('❌ Cancelled', 'No changes were saved.', 0xe74c3c)] });
            return true;
        }
        if (text.toLowerCase() === 'done' && bSession.step === 'awaiting_question') {
            if (!bSession.questions.length) {
                await message.reply({ embeds: [builderEmbed('⚠️ No questions yet', 'You need at least one question. Type it below.')] });
                return true;
            }
            bSession.step = 'final_preview';
            const dm = await message.author.createDM();
            await sendFinalPreview(dm, userId, bSession);
            return true;
        }
        if (bSession.step === 'awaiting_question') {
            if (text.length < 5) {
                await message.reply({ embeds: [builderEmbed('⚠️ Too short', 'Please type a full question.')] });
                return true;
            }
            bSession.currentQ = { text, type: 'text', choices: [], minWords: null, hint: null, required: true };
            bSession.step = 'awaiting_type';
            const dm = await message.author.createDM();
            await sendQuestionOptions(dm, userId, text);
            return true;
        }
        if (bSession.step === 'awaiting_choices') {
            const choices = text.split('|').map(c => c.trim()).filter(Boolean);
            if (choices.length < 2) {
                await message.reply({ embeds: [builderEmbed('⚠️ Need at least 2 choices', 'Separate them with `|` e.g. `Yes | No | Maybe`')] });
                return true;
            }
            bSession.currentQ.choices = choices.slice(0, 5);
            bSession.step = 'awaiting_hint_step';
            await message.reply({ embeds: [builderEmbed('✅ Choices saved', `Choices: **${bSession.currentQ.choices.join(' | ')}**`)] });
            const dm = await message.author.createDM();
            await sendHintStep(dm, userId, bSession);
            return true;
        }
        if (bSession.step === 'awaiting_minwords') {
            const n = parseInt(text, 10);
            if (isNaN(n) || n < 1 || n > 500) {
                await message.reply({ embeds: [builderEmbed('⚠️ Invalid number', 'Enter a number between 1 and 500.')] });
                return true;
            }
            bSession.currentQ.minWords = n;
            bSession.step = 'awaiting_hint_step';
            await message.reply({ embeds: [builderEmbed('✅ Min words set', `Minimum **${n} words** required.`)] });
            const dm = await message.author.createDM();
            await sendHintStep(dm, userId, bSession);
            return true;
        }
        if (bSession.step === 'awaiting_hint') {
            bSession.currentQ.hint = text.slice(0, 200);
            bSession.step = 'awaiting_required';
            await message.reply({ embeds: [builderEmbed('✅ Hint saved', `Hint: *${bSession.currentQ.hint}*`)] });
            const dm = await message.author.createDM();
            await sendRequiredStep(dm, userId, bSession);
            return true;
        }
        return false;
    }

    return false;
}

// ─── Slash command definition ─────────────────────────────────────────────────

module.exports = {
    builderSessions,
    pendingSetups,
    pendingOpens,
    pendingCloses,
    handleBuilderInteraction,
    handleBuilderMessage,
    refreshStatusBoard,
    parseQuestion,

    data: new SlashCommandBuilder()
        .setName('appbuilder')
        .setDescription('Manage application forms')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        // ── create
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Start a new application form with questions built in DM')
            .addStringOption(o => o.setName('name').setDescription('Name for this form').setRequired(true).setMaxLength(80))
        )
        // ── edit
        .addSubcommand(sub => sub
            .setName('edit')
            .setDescription('Edit the questions on an existing form via DM')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )
        // ── setup
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure log/ticket channels for a form')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )
        // ── open
        .addSubcommand(sub => sub
            .setName('open')
            .setDescription('Post the Apply button for a form')
        )
        // ── close
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close an open form and remove its Apply button')
        )
        // ── list
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all application forms')
        )
        // ── delete
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an application form')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )
        // ── setclosedate
        .addSubcommand(sub => sub
            .setName('setclosedate')
            .setDescription('Set or clear the auto-close date on an open form')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName('date').setDescription('Date & time in UTC: YYYY-MM-DD HH:MM (leave blank to clear)').setRequired(false).setMaxLength(20))
        )
        // ── statusboard
        .addSubcommand(sub => sub
            .setName('statusboard')
            .setDescription('Post or refresh the application status board in this channel')
        )
        // ── send
        .addSubcommand(sub => sub
            .setName('send')
            .setDescription('Re-send the Apply button for an already-open form')
        ),

    async execute(interaction, client) {
        const sub    = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const { AppForm, AppStatusBoard } = require('../db');

        // ── create ────────────────────────────────────────────────────────────
        if (sub === 'create') {
            const name = interaction.options.getString('name');
            const existing = await AppForm.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
            if (existing) {
                return interaction.reply({ content: `❌ A form named **${name}** already exists. Use \`/appbuilder edit\` to edit it.`, flags: 64 });
            }
            const session = { formId: null, formName: name, questions: [], currentQ: {}, step: 'greeting' };
            builderSessions.set(userId, session);
            await interaction.reply({ content: '📬 Check your DMs — I\'ve sent you the builder!', flags: 64 });
            await sendGreeting(interaction.user, session);
            return;
        }

        // ── edit ──────────────────────────────────────────────────────────────
        if (sub === 'edit') {
            const search = interaction.options.getString('form_search');
            const form   = await AppForm.findOne({ name: { $regex: search, $options: 'i' } });
            if (!form) return interaction.reply({ content: `❌ No form found matching **${search}**.`, flags: 64 });
            const session = {
                formId: String(form._id),
                formName: form.name,
                questions: (form.questions || []).map(q => {
                    // Normalize legacy string questions to the new object shape
                    if (typeof q === 'string') {
                        const parsed = parseQuestion(q);
                        return { text: parsed.display, type: parsed.type, choices: parsed.choices || [], minWords: null, hint: null, required: true };
                    }
                    return { text: q.text || String(q), type: q.type || 'text', choices: q.choices || [], minWords: q.minWords || null, hint: q.hint || null, required: q.required !== false };
                }),
                currentQ: {},
                step: 'greeting'
            };
            builderSessions.set(userId, session);
            await interaction.reply({ content: '📬 Check your DMs — I\'ve sent you the editor!', flags: 64 });
            const dm = await interaction.user.createDM();
            const previewEmbed = fullPreviewEmbed(session);
            previewEmbed.setTitle(`✏️ Editing — ${form.name}`);
            previewEmbed.setDescription(
                (previewEmbed.data.description || '*No questions yet.*') +
                '\n\nThis is what\'s currently saved. The builder will let you add, edit, or remove questions.'
            );
            await dm.send({ embeds: [previewEmbed] });
            await sendGreeting(interaction.user, session);
            return;
        }

        // ── setup ─────────────────────────────────────────────────────────────
        if (sub === 'setup') {
            const search = interaction.options.getString('form_search');
            const form   = await AppForm.findOne({ name: { $regex: search, $options: 'i' } });
            if (!form) return interaction.reply({ content: `❌ No form found matching **${search}**.`, flags: 64 });
            const session = {
                step: 'log_server',
                formId: String(form._id),
                formName: form.name,
                name: form.name,
                questions: form.questions || [],
                department: form.department || '',
                description: form.description || '',
                gameLink: form.gameLink || ''
            };
            pendingSetups.set(userId, session);
            await interaction.reply({ content: '📬 Check your DMs — the setup wizard is running there!', flags: 64 });
            const dm = await interaction.user.createDM();
            await sendSetupStepDM(dm, userId, session, client);
            return;
        }

        // ── open ──────────────────────────────────────────────────────────────
        if (sub === 'open') {
            const session = { step: 'pick_form' };
            pendingOpens.set(userId, session);
            return sendOpenStep(interaction, session, client);
        }

        // ── close ─────────────────────────────────────────────────────────────
        if (sub === 'close') {
            const session = { step: 'pick_form' };
            pendingCloses.set(userId, session);
            return sendCloseStep(interaction, session, client);
        }

        // ── list ──────────────────────────────────────────────────────────────
        if (sub === 'list') {
            const forms = await AppForm.find().sort({ department: 1, name: 1 });
            if (!forms.length) return interaction.reply({ content: 'No application forms found.', flags: 64 });
            const lines = forms.map(f => {
                const status = f.open ? '🟢 Open' : '🔴 Closed';
                const dept   = f.department ? ` *(${f.department})*` : '';
                const qs     = f.questions ? `${f.questions.length} Q` : '—';
                return `• **${f.name}**${dept} — ${status} — ${qs}`;
            });
            const embed = new EmbedBuilder()
                .setTitle('📋 Application Forms')
                .setDescription(lines.join('\n'))
                .setColor(0x5865f2);
            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        // ── delete ────────────────────────────────────────────────────────────
        if (sub === 'delete') {
            const search = interaction.options.getString('form_search');
            const form   = await AppForm.findOne({ name: { $regex: search, $options: 'i' } });
            if (!form) return interaction.reply({ content: `❌ No form found matching **${search}**.`, flags: 64 });

            // Confirm button
            await interaction.reply({
                content: `⚠️ Are you sure you want to delete **${form.name}**? This cannot be undone.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ab_confirmdelete_${form._id}_${userId}`).setLabel('🗑️ Yes, delete it').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`ab_canceldelete_${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                )],
                flags: 64
            });
            return;
        }

        // ── setclosedate ──────────────────────────────────────────────────────
        if (sub === 'setclosedate') {
            const search  = interaction.options.getString('form_search');
            const dateStr = interaction.options.getString('date');
            const form    = await AppForm.findOne({ name: { $regex: search, $options: 'i' }, open: true });
            if (!form) return interaction.reply({ content: `❌ No **open** form found matching **${search}**.`, flags: 64 });

            if (!dateStr) {
                await AppForm.findByIdAndUpdate(form._id, { closeAt: null, closeWarningDmSent: false });
                return interaction.reply({ content: `✅ Auto-close date cleared for **${form.name}**.`, flags: 64 });
            }

            const date = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z'));
            if (isNaN(date.getTime()) || date <= new Date()) {
                return interaction.reply({ content: '❌ Invalid date or date in the past. Use format: `YYYY-MM-DD HH:MM`', flags: 64 });
            }
            await AppForm.findByIdAndUpdate(form._id, { closeAt: date, closeWarningDmSent: false });
            return interaction.reply({
                content: `✅ **${form.name}** will auto-close <t:${Math.floor(date.getTime() / 1000)}:F>.`,
                flags: 64
            });
        }

        // ── statusboard ───────────────────────────────────────────────────────
        if (sub === 'statusboard') {
            const forms  = await AppForm.find().sort({ department: 1, name: 1 });
            const embed  = new EmbedBuilder()
                .setTitle('Kavia Applications')
                .setDescription(
                    'Here you can find all Kavià Café applications, along with their current status — whether they are open or closed.\n\n' +
                    'Start your journey with Kavià Café today!\n\n' +
                    '—\nIf you have any questions about your application or once you have submitted one, please open a support ticket in <#1370946382550011925> to get your results.\n\nWe look forward to our future applicants!'
                )
                .setColor(0x5865f2)
                .setThumbnail('https://cdn.discordapp.com/attachments/1420962537096351836/1428133141377187940/kaviacafe_single.png')
                .setImage('https://cdn.discordapp.com/attachments/1420962537096351836/1428133980720463942/kaviastaff_logo21.png')
                .setFooter({ text: 'Last updated' })
                .setTimestamp();

            const components = [];
            const deptButtons = new Map();
            deptButtons.set('Barista', [
                new ButtonBuilder().setURL('https://www.roblox.com/games/88140934632053/Kavia-Cafe-Interview-Center').setLabel('Join Interview Center — Barista').setStyle(ButtonStyle.Link)
            ]);
            for (const f of forms) {
                const dept = f.department || 'General';
                if (!deptButtons.has(dept)) deptButtons.set(dept, []);
                let btn;
                if (f.open) {
                    if (f.gameLink) {
                        btn = new ButtonBuilder().setURL(f.gameLink).setLabel(`Apply — ${f.name}`).setStyle(ButtonStyle.Link);
                    } else {
                        btn = new ButtonBuilder().setCustomId(`app_apply_${f._id}`).setLabel(`Apply — ${f.name}`).setStyle(ButtonStyle.Success);
                    }
                } else {
                    btn = new ButtonBuilder().setCustomId(`app_closed_${f._id}`).setLabel(`${f.name} — Closed`).setStyle(ButtonStyle.Secondary).setDisabled(true);
                }
                deptButtons.get(dept).push(btn);
            }
            for (const [, buttons] of deptButtons) {
                for (let i = 0; i < buttons.length && components.length < 5; i += 5) {
                    components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
                }
            }

            const msg = await interaction.reply({ embeds: [embed], components, fetchReply: true });

            // Save to AppStatusBoard
            try {
                await AppStatusBoard.create({ channelId: interaction.channelId, messageId: msg.id, updatedAt: new Date() });
            } catch {}

            return;
        }

        // ── send ──────────────────────────────────────────────────────────────
        if (sub === 'send') {
            const forms = await AppForm.find({ open: true }).sort({ name: 1 });
            if (!forms.length) return interaction.reply({ content: '❌ No open forms to resend.', flags: 64 });
            return interaction.reply({
                content: 'Which open form do you want to resend the Apply button for?',
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`absend_pick_form_${userId}`)
                        .setPlaceholder('Select a form')
                        .addOptions(forms.map(f => ({ label: f.name.slice(0, 100), value: String(f._id) })).slice(0, 25))
                )],
                flags: 64
            });
        }
    }
};

// ─── Extra button handlers (delete confirm) needed in index.js ────────────────
// These are handled via handleBuilderInteraction → handleBuilderButtonInteraction
// The customIds are: ab_confirmdelete_<formId>_<userId> and ab_canceldelete_<userId>

// Add to handleBuilderButtonInteraction by checking prefix
// (These are appended to the ab_ handler at runtime — handled below)

const _origBuilderBtn = handleBuilderButtonInteraction;
// Patch in delete confirm/cancel
async function handleBuilderButtonInteractionPatched(interaction, client) {
    const id     = interaction.customId;
    const userId = interaction.user.id;

    if (id.startsWith('ab_confirmdelete_') && id.endsWith(`_${userId}`)) {
        const formId = id.replace('ab_confirmdelete_', '').replace(`_${userId}`, '');
        const { AppForm } = require('../db');
        await interaction.deferUpdate();
        await AppForm.findByIdAndDelete(formId);
        await interaction.editReply({ content: '🗑️ Form deleted.', components: [] });
        return true;
    }

    if (id === `ab_canceldelete_${userId}`) {
        await interaction.update({ content: 'Cancelled.', components: [] });
        return true;
    }

    return _origBuilderBtn(interaction, client);
}

// Override the exported handler
module.exports.handleBuilderInteraction = async function(interaction, client) {
    const id = interaction.customId;
    if (!id) return false;

    // ── Question jump dropdown ────────────────────────────────────────────────
    const userId = interaction.user.id;
    if (id === `ab_jumpq_${userId}`) {
        const session = builderSessions.get(userId);
        if (!session) {
            await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Run the command again.')], components: [] }).catch(() => {});
            return true;
        }
        const index = parseInt(interaction.values[0], 10);
        const q = session.questions[index];
        if (!q) {
            await interaction.update({ embeds: [builderEmbed('⚠️ Not found', 'That question no longer exists.')], components: [] }).catch(() => {});
            return true;
        }
        // Pull it out for re-editing
        session.editIndex = index;
        session.currentQ  = { ...q };
        session.questions.splice(index, 1);
        session.step = 'awaiting_question';
        await interaction.update({
            embeds: [builderEmbed(`✏️ Editing Q${index + 1}`, `**Current text:**\n> ${q.text}\n\nType the new question text below, or retype it to keep it the same.`)],
            components: []
        });
        return true;
    }

    if (id.startsWith('ab_')) return handleBuilderButtonInteractionPatched(interaction, client);
    if (id.startsWith('absetup_')) return handleSetupInteraction(interaction, client);
    if (id.startsWith('abopen_'))  return handleOpenInteraction(interaction, client);
    if (id.startsWith('abclose_')) return handleCloseInteraction(interaction, client);
    if (id.startsWith('absend_'))  return handleSendPick(interaction, client);
    return false;
};