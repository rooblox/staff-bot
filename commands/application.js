const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits,
    StringSelectMenuBuilder
} = require('discord.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function guildOptions(client) {
    return [...client.guilds.cache.values()]
        .slice(0, 25)
        .map(g => ({ label: g.name.slice(0, 100), value: g.id }));
}

async function channelOptions(client, guildId) {
    try {
        let guild = client.guilds.cache.get(guildId);
        if (!guild) guild = await client.guilds.fetch(guildId);
        if (guild.channels.cache.size === 0) await guild.channels.fetch();
        return [...guild.channels.cache.values()]
            .filter(c => c && c.name && c.isTextBased() && !(c.isThread && c.isThread()))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 24) // leave room for a "manual entry" option if needed
            .map(c => ({ label: `#${c.name}`.slice(0, 100), value: c.id }));
    } catch { return []; }
}

// ─── In-memory sessions ──────────────────────────────────────────────────────
const pendingDMs     = new Map(); // userId -> DM application flow
const pendingSetups  = new Map(); // userId -> setup wizard session
const pendingOpens   = new Map(); // userId -> open wizard session
const pendingCloses  = new Map(); // userId -> close wizard session

// ─── Step renderer for setup wizard ─────────────────────────────────────────

function stepEmbed(title, desc) {
    return new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(desc);
}

function manualIdButton(customId, label) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary);
}

async function sendSetupStep(interaction, session, isUpdate = false) {
    const client = interaction.client;
    const uid    = interaction.user.id;
    let embed, components;

    if (session.step === 'log_server') {
        embed = stepEmbed('Step 1 of 4 — Log Server', 'Which server should submissions be logged in?');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_logserver_${uid}`)
                .setPlaceholder('Select a server…')
                .addOptions(guildOptions(client))
        )];

    } else if (session.step === 'log_channel') {
        const opts = await channelOptions(client, session.logServerId);
        embed = stepEmbed('Step 2 of 4 — Log Channel',
            `Which channel in **${session.logServerName}** should submissions post to?\n${opts.length < 2 ? '\n⚠️ Few channels visible — use the button below to enter a channel ID manually.' : ''}`);
        components = [];
        if (opts.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`appsetup_logchannel_${uid}`)
                    .setPlaceholder('Select a channel…')
                    .addOptions(opts)
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            manualIdButton(`appsetup_logchannel_manual_${uid}`, '📋 Enter channel ID manually')
        ));

    } else if (session.step === 'ticket_server') {
        embed = stepEmbed('Step 3 of 4 — Ticket Server',
            `Log: **#${session.logChannelName}** in **${session.logServerName}** ✅\n\nWhich server should applicants open support tickets in?`);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_ticketserver_${uid}`)
                .setPlaceholder('Select a server…')
                .addOptions(guildOptions(client))
        )];

    } else if (session.step === 'ticket_channel') {
        const opts = await channelOptions(client, session.ticketServerId);
        embed = stepEmbed('Step 4 of 5 — Ticket Channel',
            `Which channel in **${session.ticketServerName}** should applicants open tickets in?\n${opts.length < 2 ? '\n⚠️ Few channels visible — use the button below to enter a channel ID manually.' : ''}`);
        components = [];
        if (opts.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`appsetup_ticketchannel_${uid}`)
                    .setPlaceholder('Select a channel…')
                    .addOptions(opts)
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            manualIdButton(`appsetup_ticketchannel_manual_${uid}`, '📋 Enter channel ID manually')
        ));

    } else if (session.step === 'notify_role') {
        embed = stepEmbed('Step 5 of 5 — Notify Role',
            `Log: **#${session.logChannelName}** ✅  Tickets: **#${session.ticketChannelName}** ✅\n\nWhich role should be pinged when a new application comes in?\n\nPing the role in chat (e.g. \`@HR Team\`) **or** paste a role ID, then click **Enter Role ID** below.\nClick **Skip (use default)** to use the server's default notification role.`);
        components = [new ActionRowBuilder().addComponents(
            manualIdButton(`appsetup_notifyrole_manual_${uid}`, '📋 Enter Role ID'),
            new ButtonBuilder()
                .setCustomId(`appsetup_notifyrole_skip_${uid}`)
                .setLabel('⏭️ Skip (use default)')
                .setStyle(ButtonStyle.Secondary)
        )];
    }

    const payload = { embeds: [embed], components, flags: 64 };
    if (isUpdate) return interaction.update(payload);
    return interaction.reply(payload);
}

// Shown after ticket channel is picked — collects name (pre-filled) + description (paragraph, up to 4000 chars)
function formDetailsModal(name) {
    const modal = new ModalBuilder()
        .setCustomId('app_setup_details')
        .setTitle('Form Details');
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('form_name')
                .setLabel('Form name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80)
                .setValue(name)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('form_department')
                .setLabel('Department (e.g. Barista, Management, Media)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(50)
                .setPlaceholder('e.g. Barista Team')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('form_game_link')
                .setLabel('Game link (optional — skips DM questions)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(200)
                .setPlaceholder('https://www.roblox.com/games/… — leave blank for a question-based form')
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('form_description')
                .setLabel('Description (shown on the Apply message)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(4000)
                .setPlaceholder('Describe the role, requirements, expectations… anything you want applicants to read before applying.')
        )
    );
    return modal;
}

// round: 1, 2, or 3  (questions 1-5, 6-10, 11-15)
function questionsModal(name, round = 1, customId = 'app_setup_questions_1') {
    const base  = (round - 1) * 5; // 0, 5, 10
    const req   = round === 1;
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`Q${base + 1}–${base + 5}: ${name.slice(0, 38)}`);
    for (let i = 1; i <= 5; i++) {
        const num      = base + i;
        const required = req && i <= 2; // first round needs at least 2
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(`q${num}`)
                .setLabel(`Question ${num}${required ? '' : ' (optional)'}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(required)
                .setMaxLength(200)
                .setPlaceholder(
                    num === 1 ? 'e.g. What is your Roblox username?' :
                    num === 2 ? '[SCALE] How would you rate your experience? (1–10)' :
                    num === 3 ? '[CHOICE: Yes|No|Maybe] Are you 13 or older?' :
                    num === 4 ? 'Prefix [SCALE] for 1–10 slider, [CHOICE: A|B|C] for buttons' : ''
                )
        ));
    }
    return modal;
}

// ─── Question type parser ─────────────────────────────────────────────────────
// Returns { type: 'text'|'scale'|'choice', display: string, choices: string[] }
function parseQuestion(raw) {
    const scaleMatch = raw.match(/^\[SCALE\]\s*/i);
    if (scaleMatch) return { type: 'scale', display: raw.replace(/^\[SCALE\]\s*/i, ''), choices: [] };

    const choiceMatch = raw.match(/^\[CHOICE:\s*(.+)\]\s*/i);
    if (choiceMatch) {
        const choices = choiceMatch[1].split('|').map(c => c.trim()).filter(Boolean).slice(0, 5);
        return { type: 'choice', display: raw.replace(/^\[CHOICE:[^\]]*\]\s*/i, ''), choices };
    }

    return { type: 'text', display: raw, choices: [] };
}

// ─── Open wizard step renderer ───────────────────────────────────────────────

async function sendOpenStep(interaction, session, isUpdate = false) {
    const client = interaction.client;
    const uid    = interaction.user.id;
    let embed, components;

    if (session.step === 'pick_form') {
        const { AppForm } = require('../db');
        const forms = await AppForm.find().sort({ createdAt: -1 }).limit(25);
        if (!forms.length) {
            const msg = { content: '❌ No forms yet. Use `/application setup` first.', flags: 64 };
            return isUpdate ? interaction.update(msg) : interaction.reply(msg);
        }
        const totalSteps = client.guilds.cache.size > 1 ? 3 : 2;
        embed = stepEmbed(`Open — Step 1 of ${totalSteps}`,
            'Pick the form you want to open. The Apply button will be posted in a channel of your choice.');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appopen_form_${uid}`)
                .setPlaceholder('Select a form…')
                .addOptions(forms.map(f => ({
                    label: f.name.slice(0, 100),
                    value: String(f._id),
                    description: `${f.department || 'General'} · ${f.gameLink ? 'Game link' : `${f.questions.length} questions`} · ${f.open ? '🟢 Open' : '🔴 Closed'}`
                        .slice(0, 100)
                })))
        )];

    } else if (session.step === 'pick_server') {
        embed = stepEmbed('Open — Step 2 of 3',
            `Form: **${session.formName}** ✅\n\nWhich server should the Apply button be posted in?`);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appopen_server_${uid}`)
                .setPlaceholder('Select a server…')
                .addOptions(guildOptions(client))
        )];

    } else if (session.step === 'pick_channel') {
        const opts = await channelOptions(client, session.serverId);
        const totalSteps = client.guilds.cache.size > 1 ? 3 : 2;
        const stepNum    = totalSteps === 3 ? 3 : 2;
        embed = stepEmbed(`Open — Step ${stepNum} of ${totalSteps}`,
            `Form: **${session.formName}** ✅\n${totalSteps === 3 ? `Server: **${session.serverName}** ✅\n` : ''}` +
            `\nWhich channel should the Apply button be posted in?`);
        components = [];
        if (opts.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`appopen_channel_${uid}`)
                    .setPlaceholder('Select a channel…')
                    .addOptions(opts)
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            manualIdButton(`appopen_channel_manual_${uid}`, '📋 Enter channel ID manually'),
            new ButtonBuilder()
                .setCustomId(`appopen_attach_${uid}`)
                .setLabel('📌 Attach to existing message')
                .setStyle(ButtonStyle.Secondary)
        ));
    }

    const payload = { embeds: [embed], components, flags: 64 };
    if (isUpdate) return interaction.update(payload);
    return interaction.reply(payload);
}

// ─── Close wizard step renderer ──────────────────────────────────────────────

async function sendCloseStep(interaction, session, isUpdate = false) {
    const uid = interaction.user.id;
    const { AppForm } = require('../db');

    const forms = await AppForm.find({ open: true }).sort({ createdAt: -1 }).limit(25);
    if (!forms.length) {
        const msg = { content: '❌ No open forms right now. Nothing to close.', flags: 64 };
        return isUpdate ? interaction.update(msg) : interaction.reply(msg);
    }

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('Close a Form')
        .setDescription('Pick the form you want to close. Its Apply button will be removed.');

    const components = [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`appclose_form_${uid}`)
            .setPlaceholder('Select a form to close…')
            .addOptions(forms.map(f => ({
                label: f.name.slice(0, 100),
                value: String(f._id),
                description: `${f.department || 'General'} · ${f.questions.length} question${f.questions.length !== 1 ? 's' : ''} · 🟢 Open`
                    .slice(0, 100)
            })))
    )];

    const payload = { embeds: [embed], components, flags: 64 };
    return isUpdate ? interaction.update(payload) : interaction.reply(payload);
}

// ─── Module ──────────────────────────────────────────────────────────────────

module.exports = {
    pendingDMs,
    pendingSetups,
    pendingOpens,
    pendingCloses,
    refreshStatusBoard,
    parseQuestion,

    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Application form system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Create a new application form')
            .addStringOption(o => o.setName('name').setDescription('Name for this form e.g. "Barista Application"').setRequired(true).setMaxLength(80))
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all application forms')
        )
        .addSubcommand(sub => sub
            .setName('open')
            .setDescription('Open a form and post the Apply button in a channel')
        )
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close a form and remove its Apply button')
        )
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an application form permanently')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )
        .addSubcommand(sub => sub
            .setName('statusboard')
            .setDescription('Post a live status board that auto-updates when forms open or close')
        )
        .addSubcommand(sub => sub
            .setName('send')
            .setDescription('Send an application link directly into this channel (e.g. inside a ticket)')
        ),

    async execute(interaction) {
        try {
            const sub    = interaction.options.getSubcommand();
            const client = interaction.client;

            const { AppForm } = require('../db');

            if (sub === 'setup') {
                const session = {
                    step: 'log_server',
                    name: interaction.options.getString('name'),
                    description: '',
                    createdBy: interaction.user.id,
                    createdByTag: interaction.user.tag
                };
                pendingSetups.set(interaction.user.id, session);
                return sendSetupStep(interaction, session, false);
            }

            if (sub === 'list') {
                const forms = await AppForm.find().sort({ createdAt: -1 }).limit(20);
                if (!forms.length) return interaction.editReply({ content: '❌ No application forms yet. Use `/application setup` to create one.' });
                const embed = new EmbedBuilder()
                    .setTitle('📋 Application Forms')
                    .setColor(0x5865f2)
                    .setDescription(forms.map(f =>
                        `**${f.name}**\n${f.questions.length} questions · Log: #${f.logChannelName} in ${f.logServerName} · ${f.open ? '🟢 Open' : '🔴 Closed'}`
                    ).join('\n\n'));
                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'open') {
                const session = { step: 'pick_form' };
                pendingOpens.set(interaction.user.id, session);
                return sendOpenStep(interaction, session, false);
            }

            if (sub === 'close') {
                const session = {};
                pendingCloses.set(interaction.user.id, session);
                return sendCloseStep(interaction, session, false);
            }

            if (sub === 'delete') {
                const q      = interaction.options.getString('form_search').toLowerCase().trim();
                const forms  = await AppForm.find();
                const matched = forms.filter(f => f.name.toLowerCase().includes(q));
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });
                await AppForm.findByIdAndDelete(matched[0]._id);
                await refreshStatusBoard(client);
                return interaction.editReply({ content: `✅ **${matched[0].name}** deleted.` });
            }

            if (sub === 'statusboard') {
                const { AppStatusBoard } = require('../db');

                // Post a placeholder, then immediately fill it via refreshStatusBoard
                // so there is only ONE place that builds the embed/buttons
                const placeholder = await interaction.channel.send({ content: '⏳ Loading status board...' });

                // Upsert: one board per channel
                await AppStatusBoard.findOneAndUpdate(
                    { guildId: interaction.guild.id, channelId: interaction.channel.id },
                    { guildId: interaction.guild.id, channelId: interaction.channel.id, messageId: placeholder.id, updatedAt: new Date() },
                    { upsert: true }
                );

                // Now fill it with the real embed + buttons
                await refreshStatusBoard(client);

                return interaction.editReply({ content: `✅ Status board posted! It will automatically update whenever forms are opened or closed.` });
            }

            if (sub === 'send') {
                // Show staff a dropdown of all forms — they pick one and the bot posts
                // a one-time Apply button directly in this channel (e.g. inside a ticket)
                const forms = await AppForm.find().sort({ createdAt: -1 }).limit(25);
                if (!forms.length) return interaction.editReply({ content: '❌ No application forms exist yet. Use `/application setup` to create one first.' });

                const options = forms.map(f => ({
                    label: f.name.slice(0, 100),
                    description: `${f.open ? '🟢 Open' : '🔴 Closed'} · ${f.questions.length} question${f.questions.length !== 1 ? 's' : ''}`,
                    value: String(f._id)
                }));

                const selectRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`appsend_pick_${interaction.user.id}`)
                        .setPlaceholder('Which application do you want to send here?')
                        .addOptions(options)
                );

                return interaction.editReply({
                    content: '📋 Pick the application you want to drop into this channel:',
                    components: [selectRow]
                });
            }

        } catch (err) {
            console.error('[application execute error]', err);
            const msg = { content: '❌ Something went wrong. Check the bot logs.', flags: 64 };
            if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
            else await interaction.reply(msg).catch(() => {});
        }
    },

    // ── Setup select menus + manual-ID buttons ───────────────────────────────
    // index.js: if (interaction.customId.startsWith('appsetup_')) { await require('./commands/application').handleSetupSelect(interaction); return; }
    async handleSetupSelect(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.update({ content: '❌ Session expired. Run `/application setup` again.', embeds: [], components: [] });

            const id     = interaction.customId;
            const client = interaction.client;

            // ── Manual ID buttons + start-questions button (isButton) ──
            if (interaction.isButton()) {
                // "Add Questions" button shown after form details modal
                if (id === `appsetup_startquestions_${uid}`) {
                    return interaction.showModal(questionsModal(session.name, 1, 'app_setup_questions_1'));
                }

                // "Continue — Form Details" button shown after notify role modal submit
                // (modal→modal not allowed in Discord; we reply with a button instead)
                if (id === `appsetup_opendetails_${uid}`) {
                    return interaction.showModal(formDetailsModal(session.name));
                }

                // Notify role: enter role ID manually
                if (id === `appsetup_notifyrole_manual_${uid}`) {
                    const modal = new ModalBuilder()
                        .setCustomId(`appsetup_notifyrole_id_${uid}`)
                        .setTitle('Notify Role ID');
                    modal.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('role_id')
                            .setLabel('Role ID (blank = default)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setMinLength(0).setMaxLength(20)
                            .setPlaceholder('e.g. 1480839573390233702')
                    ));
                    return interaction.showModal(modal);
                }

                // Notify role: skip — use default
                if (id === `appsetup_notifyrole_skip_${uid}`) {
                    session.notifyRoleId = '1480839573390233702';
                    return interaction.showModal(formDetailsModal(session.name));
                }

                let step, field;
                if (id === `appsetup_logchannel_manual_${uid}`)    { step = 'log_channel';    field = 'log'; }
                if (id === `appsetup_ticketchannel_manual_${uid}`) { step = 'ticket_channel'; field = 'ticket'; }
                if (!step) return;

                const modal = new ModalBuilder()
                    .setCustomId(`appsetup_manualch_${field}_${uid}`)
                    .setTitle(field === 'log' ? 'Log Channel ID' : 'Ticket Channel ID');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('channel_id')
                        .setLabel('Paste the channel ID')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(17).setMaxLength(20)
                        .setPlaceholder('e.g. 1370946382550011925')
                ));
                return interaction.showModal(modal);
            }

            // ── Select menus ──
            const value = interaction.values[0];

            if (id === `appsetup_logserver_${uid}`) {
                const guild = client.guilds.cache.get(value);
                session.logServerId   = value;
                session.logServerName = guild ? guild.name : value;
                session.step = 'log_channel';
                return sendSetupStep(interaction, session, true);
            }
            if (id === `appsetup_logchannel_${uid}`) {
                const guild = client.guilds.cache.get(session.logServerId);
                const ch    = guild ? guild.channels.cache.get(value) : null;
                session.logChannelId   = value;
                session.logChannelName = ch ? ch.name : value;
                session.step = 'ticket_server';
                return sendSetupStep(interaction, session, true);
            }
            if (id === `appsetup_ticketserver_${uid}`) {
                const guild = client.guilds.cache.get(value);
                session.ticketServerId   = value;
                session.ticketServerName = guild ? guild.name : value;
                session.step = 'ticket_channel';
                return sendSetupStep(interaction, session, true);
            }
            if (id === `appsetup_ticketchannel_${uid}`) {
                const guild = client.guilds.cache.get(session.ticketServerId);
                const ch    = guild ? guild.channels.cache.get(value) : null;
                session.ticketChannelId   = value;
                session.ticketChannelName = ch ? ch.name : value;
                session.step = 'notify_role';
                return sendSetupStep(interaction, session, true);
            }

            // Notify role: skip button sets default role ID and moves to details
            if (id === `appsetup_notifyrole_skip_${uid}`) {
                session.notifyRoleId = '1480839573390233702';
                return interaction.showModal(formDetailsModal(session.name));
            }

        } catch (err) {
            console.error('[appsetup select error]', err);
            await interaction.update({ content: '❌ Something went wrong. Try `/application setup` again.', embeds: [], components: [] }).catch(() => {});
        }
    },

    // ── Setup manual channel ID modal submits ────────────────────────────────
    // index.js: if (interaction.customId.startsWith('appsetup_manualch_')) { await require('./commands/application').handleSetupManualChannel(interaction); return; }
    async handleSetupManualChannel(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', flags: 64 });

            const parts   = interaction.customId.split('_'); // appsetup_manualch_log/ticket_uid
            const field   = parts[2]; // 'log' or 'ticket'
            const chId    = interaction.fields.getTextInputValue('channel_id').trim();
            const client  = interaction.client;

            // Try to resolve the channel name
            let chName = chId;
            try {
                const ch = await client.channels.fetch(chId);
                chName = ch.name;
            } catch {}

            if (field === 'log') {
                session.logChannelId   = chId;
                session.logChannelName = chName;
                session.step = 'ticket_server';
            } else {
                session.ticketChannelId   = chId;
                session.ticketChannelName = chName;
            }

            if (field === 'ticket') {
                // Move to notify_role step
                session.step = 'notify_role';
                return sendSetupStep(interaction, session, false);
            }

            // Continue to next step
            return sendSetupStep(interaction, session, false);

        } catch (err) {
            console.error('[appsetup manualch error]', err);
            await interaction.reply({ content: '❌ Something went wrong. Try `/application setup` again.', flags: 64 }).catch(() => {});
        }
    },

    // ── Notify role ID modal submit ──────────────────────────────────────────────
    // index.js: if (interaction.customId.startsWith('appsetup_notifyrole_id_')) { await require('./commands/application').handleNotifyRoleModal(interaction); return; }
    async handleNotifyRoleModal(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', flags: 64 });

            const raw    = interaction.fields.getTextInputValue('role_id').trim();
            // Accept a role mention like <@&12345> or a raw ID
            const roleId = raw.replace(/[^0-9]/g, '') || '1480839573390233702';
            session.notifyRoleId = roleId;

            // Can't chain modal→modal — reply with a button to open form details instead
            return interaction.reply({
                flags: 64,
                content: `✅ Notify role saved (\`${roleId}\`). Click below to continue.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`appsetup_opendetails_${interaction.user.id}`)
                        .setLabel('📝 Continue — Form Details')
                        .setStyle(ButtonStyle.Primary)
                )]
            });
        } catch (err) {
            console.error('[appsetup notifyrole modal error]', err);
            await interaction.reply({ content: '❌ Something went wrong. Try `/application setup` again.', flags: 64 }).catch(() => {});
        }
    },

    // ── Form details modal (name + description, shown before questions) ─────────
    // index.js: if (interaction.customId === 'app_setup_details') { await require('./commands/application').handleSetupDetails(interaction); return; }
    async handleSetupDetails(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', flags: 64 });

            session.name        = interaction.fields.getTextInputValue('form_name').trim();
            session.department  = interaction.fields.getTextInputValue('form_department').trim() || 'General';
            session.gameLink    = interaction.fields.getTextInputValue('form_game_link').trim() || null;
            session.description = interaction.fields.getTextInputValue('form_description').trim();

            // Game-link forms don't need questions — save immediately
            if (session.gameLink) {
                return interaction.reply({
                    flags: 64,
                    content: `✅ Details saved!\n**Name:** ${session.name}\n**Department:** ${session.department}\n**Game Link:** ${session.gameLink}${session.description ? `\n**Description:** ${session.description.slice(0, 100)}${session.description.length > 100 ? '…' : ''}` : ''}\n\nThis form links directly to the game — no questions needed. Click to save.`,
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`appsetup_savelink_${uid}`)
                            .setLabel('💾 Save Form')
                            .setStyle(ButtonStyle.Success)
                    )]
                });
            }

            // Can't chain modal→modal in Discord — reply with a button to open questions
            return interaction.reply({
                flags: 64,
                content: `✅ Details saved!\n**Name:** ${session.name}\n**Department:** ${session.department}${session.description ? `\n**Description:** ${session.description.slice(0, 100)}${session.description.length > 100 ? '…' : ''}` : ''}\n\nNow click below to add your questions.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`appsetup_startquestions_${uid}`)
                        .setLabel('➕ Add Questions')
                        .setStyle(ButtonStyle.Primary)
                )]
            });
        } catch (err) {
            console.error('[app_setup_details error]', err);
            await interaction.reply({ content: '❌ Something went wrong. Try `/application setup` again.', flags: 64 }).catch(() => {});
        }
    },

    // ── Questions modal submit (rounds 1–3, customId: app_setup_questions_1/2/3) ──
    // index.js: if (interaction.customId.startsWith('app_setup_questions_')) { await require('./commands/application').handleSetupModal(interaction); return; }
    async handleSetupModal(interaction) {
        try {
            const { AppForm } = require('../db');
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', flags: 64 });

            const round = parseInt(interaction.customId.slice(-1)); // 1, 2, or 3
            const base  = (round - 1) * 5;

            // Collect this round's answers
            if (!session.questions) session.questions = [];
            for (let i = 1; i <= 5; i++) {
                const val = interaction.fields.getTextInputValue(`q${base + i}`).trim();
                if (val) session.questions.push(val);
            }

            // Round 1: must have at least 2
            if (round === 1 && session.questions.length < 2) {
                session.questions = [];
                return interaction.reply({ content: '❌ Please fill in at least 2 questions.', flags: 64 });
            }

            // If under 15 and not on round 3, offer to add more
            if (round < 3 && session.questions.length < 15) {
                const addMoreBtn = new ButtonBuilder()
                    .setCustomId(`appsetup_addmore_${round + 1}_${uid}`)
                    .setLabel(`➕ Add questions ${base + 6}–${base + 10}`)
                    .setStyle(ButtonStyle.Secondary);
                const doneBtn = new ButtonBuilder()
                    .setCustomId(`appsetup_savequestions_${uid}`)
                    .setLabel('✅ Done — save form')
                    .setStyle(ButtonStyle.Success);
                return interaction.reply({
                    flags: 64,
                    content: `Got **${session.questions.length}** question(s) so far. Add more or save now.`,
                    components: [new ActionRowBuilder().addComponents(addMoreBtn, doneBtn)]
                });
            }

            // Round 3 or at 15 — save immediately
            return saveForm(interaction, session);

        } catch (err) {
            console.error('[app_setup_questions modal error]', err);
            await interaction.reply({ content: '❌ Failed to save the form. Check the bot logs.', flags: 64 }).catch(() => {});
        }
    },

    // ── "Add more questions" button + "Done" button ──────────────────────────
    // index.js: if (interaction.customId.startsWith('appsetup_addmore_') || interaction.customId.startsWith('appsetup_savequestions_')) { await require('./commands/application').handleSetupQuestionsButton(interaction); return; }
    async handleSetupQuestionsButton(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.update({ content: '❌ Session expired. Run `/application setup` again.', embeds: [], components: [] });

            // Game-link form: save directly without questions
            if (interaction.customId.startsWith('appsetup_savelink_')) {
                await interaction.deferUpdate();
                return saveForm(interaction, session);
            }

            if (interaction.customId.startsWith('appsetup_savequestions_')) {
                // update replaces the button message; saveForm will editReply with the result
                await interaction.deferUpdate();
                return saveForm(interaction, session);
            }

            // appsetup_addmore_<round>_<uid>
            // showModal MUST be the first and only response to a button interaction
            const round = parseInt(interaction.customId.split('_')[2]);
            return interaction.showModal(questionsModal(session.name, round, `app_setup_questions_${round}`));

        } catch (err) {
            console.error('[appsetup questions button error]', err);
            await interaction.update({ content: '❌ Something went wrong.', components: [] }).catch(() => {});
        }
    },

    // ── Open wizard select menus + manual button ─────────────────────────────
    // index.js: if (interaction.customId.startsWith('appopen_')) { await require('./commands/application').handleOpenSelect(interaction); return; }
    async handleOpenSelect(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingOpens.get(uid);
            if (!session) return interaction.update({ content: '❌ Session expired. Run `/application open` again.', embeds: [], components: [] });

            const id     = interaction.customId;
            const client = interaction.client;

            // "Attach to existing message" button — ask for message ID via modal
            if (interaction.isButton() && id === `appopen_attach_${uid}`) {
                const modal = new ModalBuilder()
                    .setCustomId(`appopen_attachmsg_${uid}`)
                    .setTitle('Attach to Existing Message');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('channel_id')
                            .setLabel('Channel ID')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true).setMinLength(17).setMaxLength(20)
                            .setPlaceholder('e.g. 1234567890123456789')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('message_id')
                            .setLabel('Message ID (must be a message I sent)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true).setMinLength(17).setMaxLength(20)
                            .setPlaceholder('e.g. 1234567890123456789')
                    )
                );
                return interaction.showModal(modal);
            }

            // Manual channel ID button
            if (interaction.isButton() && id === `appopen_channel_manual_${uid}`) {
                const modal = new ModalBuilder()
                    .setCustomId(`appopen_manualch_${uid}`)
                    .setTitle('Channel ID');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('channel_id')
                        .setLabel('Paste the channel ID to post the button in')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true).setMinLength(17).setMaxLength(20)
                        .setPlaceholder('e.g. 1234567890123456789')
                ));
                return interaction.showModal(modal);
            }

            const value = interaction.values[0];

            if (id === `appopen_form_${uid}`) {
                const { AppForm } = require('../db');
                const form = await AppForm.findById(value);
                if (!form) return interaction.update({ content: '❌ Form not found.', embeds: [], components: [] });
                session.formId   = String(form._id);
                session.formName = form.name;
                session.formDesc = form.description || '';
                // Auto-skip server step if bot is only in one guild
                if (client.guilds.cache.size === 1) {
                    const guild = [...client.guilds.cache.values()][0];
                    session.serverId   = guild.id;
                    session.serverName = guild.name;
                    session.step       = 'pick_channel';
                } else {
                    session.step = 'pick_server';
                }
                return sendOpenStep(interaction, session, true);
            }

            if (id === `appopen_server_${uid}`) {
                const guild = client.guilds.cache.get(value);
                session.serverId   = value;
                session.serverName = guild ? guild.name : value;
                session.step       = 'pick_channel';
                return sendOpenStep(interaction, session, true);
            }

            if (id === `appopen_channel_${uid}`) {
                await finishOpen(interaction, session, value, client);
            }

        } catch (err) {
            console.error('[appopen select error]', err);
            await interaction.update({ content: '❌ Something went wrong. Try `/application open` again.', embeds: [], components: [] }).catch(() => {});
        }
    },

    // ── Open wizard manual channel modal ────────────────────────────────────
    // index.js: if (interaction.customId.startsWith('appopen_manualch_')) { await require('./commands/application').handleOpenManualChannel(interaction); return; }
    async handleOpenManualChannel(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingOpens.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application open` again.', flags: 64 });
            const chId   = interaction.fields.getTextInputValue('channel_id').trim();
            const client = interaction.client;
            await finishOpen(interaction, session, chId, client);
        } catch (err) {
            console.error('[appopen manual error]', err);
            await interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
        }
    },

    // ── Open wizard "attach to existing message" modal ───────────────────────
    // index.js: if (interaction.customId.startsWith('appopen_attachmsg_')) { await require('./commands/application').handleOpenAttachMessage(interaction); return; }
    async handleOpenAttachMessage(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingOpens.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application open` again.', flags: 64 });
            const chId  = interaction.fields.getTextInputValue('channel_id').trim();
            const msgId = interaction.fields.getTextInputValue('message_id').trim();
            session.messageId = msgId;
            const client = interaction.client;
            await finishOpen(interaction, session, chId, client);
        } catch (err) {
            console.error('[appopen attach error]', err);
            await interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
        }
    },

    // ── Close wizard form select ─────────────────────────────────────────────
    // index.js: if (interaction.customId.startsWith('appclose_form_')) { await require('./commands/application').handleCloseSelect(interaction); return; }
    async handleCloseSelect(interaction) {
        try {
            const uid    = interaction.user.id;
            const client = interaction.client;
            if (!interaction.customId.endsWith(uid)) return interaction.reply({ content: '❌ This menu is not for you.', flags: 64 });

            const formId = interaction.values[0];
            const { AppForm } = require('../db');
            const form = await AppForm.findById(formId);
            if (!form) return interaction.update({ content: '❌ Form not found.', embeds: [], components: [] });

            await AppForm.findByIdAndUpdate(form._id, { open: false });

            if (form.openMessageId && form.openChannelId) {
                try {
                    const ch  = await client.channels.fetch(form.openChannelId);
                    const msg = await ch.messages.fetch(form.openMessageId);
                    if (msg.author.id === client.user.id) await msg.edit({ components: [] });
                } catch {}
            }

            await refreshStatusBoard(client);
            pendingCloses.delete(uid);
            return interaction.update({ content: `✅ **${form.name}** is now closed. The Apply button has been removed.`, embeds: [], components: [] });
        } catch (err) {
            console.error('[appclose select error]', err);
            await interaction.update({ content: '❌ Something went wrong. Try `/application close` again.', embeds: [], components: [] }).catch(() => {});
        }
    },

    // ── /application send — drop an Apply button directly into this channel ──
    // index.js: if (interaction.customId.startsWith('appsend_pick_')) { await require('./commands/application').handleSendPick(interaction); return; }
    async handleSendPick(interaction) {
        try {
            const uid    = interaction.user.id;
            // Only the person who ran the command can use the select
            if (!interaction.customId.endsWith(uid)) {
                return interaction.reply({ content: '❌ This menu is not for you.', flags: 64 });
            }

            const formId = interaction.values[0];
            const { AppForm } = require('../db');
            const form = await AppForm.findById(formId).catch(() => null);
            if (!form) return interaction.update({ content: '❌ Form not found.', components: [] });

            const applyRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`app_apply_${String(form._id)}`)
                    .setLabel('Apply Now 📝')
                    .setStyle(ButtonStyle.Primary)
            );

            // Post the Apply button in this channel (visible to everyone)
            await interaction.channel.send({
                content: `> 📝 **${form.name}**${form.description ? ` — ${form.description}` : ''}\n> Click below to apply. Make sure your DMs are open!`,
                components: [applyRow]
            });

            // Confirm to the staff member (ephemeral — just them)
            return interaction.update({
                content: `✅ **${form.name}** apply button posted in this channel!`,
                components: []
            });
        } catch (err) {
            console.error('[appsend pick error]', err);
            await interaction.update({ content: '❌ Something went wrong.', components: [] }).catch(() => {});
        }
    }
};

// ─── Status board refresh ────────────────────────────────────────────────────
// Call this any time a form is opened or closed to keep all board messages in sync.

async function refreshStatusBoard(client) {
    try {
        const { AppForm, AppStatusBoard } = require('../db');
        const boards = await AppStatusBoard.find();
        if (!boards.length) return;

        const forms = await AppForm.find().sort({ department: 1, name: 1 });

        // Group by department
        const byDept = new Map();
        for (const f of forms) {
            const dept = f.department || 'General';
            if (!byDept.has(dept)) byDept.set(dept, []);
            byDept.get(dept).push(f);
        }

        // Build embed description: one section per dept
        const descSections = [];
        // Hardcoded Barista is always first and always open
        descSections.push('**Barista**\n🟢 **Barista** — OPEN');
        for (const [dept, deptForms] of byDept) {
            const lines = deptForms.map(f =>
                `${f.open ? '🟢' : '🔴'} **${f.name}** — ${f.open ? 'OPEN' : 'CLOSED'}`
            );
            descSections.push(`**${dept}**\n${lines.join('\n')}`);
        }
        if (forms.length === 0 && descSections.length === 1) {
            // Only the hardcoded barista line — skip the "no forms" message
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
            .setFooter({ text: `Last updated` })
            .setTimestamp();

        // Build Apply buttons grouped by dept — max 5 rows × 5 buttons = 25 total
        // Each dept gets its own row; if a dept has more than 5 forms they overflow to next row
        // Open forms get green/link buttons; closed forms get grey disabled buttons
        const components = [];

        // Hardcoded always-open Barista link
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
                btn = f.gameLink
                    ? new ButtonBuilder()
                        .setURL(f.gameLink)
                        .setLabel(`Apply — ${f.name}`)
                        .setStyle(ButtonStyle.Link)
                    : new ButtonBuilder()
                        .setCustomId(`app_apply_${f._id}`)
                        .setLabel(`Apply — ${f.name}`)
                        .setStyle(ButtonStyle.Success);
            } else {
                // Closed — show as disabled button so newly-created forms are visible on the board
                btn = new ButtonBuilder()
                    .setCustomId(`app_closed_${f._id}`)
                    .setLabel(`${f.name} — Closed`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
            }
            deptButtons.get(dept).push(btn);
        }

        for (const [, buttons] of deptButtons) {
            // Chunk into rows of 5
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
                await AppStatusBoard.findByIdAndUpdate(board._id, { updatedAt: new Date() });
            } catch (err) {
                console.error('[statusboard refresh error]', err);
            }
        }
    } catch (err) {
        console.error('[refreshStatusBoard error]', err);
    }
}

// ─── Shared save-form logic ──────────────────────────────────────────────────

async function saveForm(interaction, session) {
    const { AppForm } = require('../db');
    pendingSetups.delete(interaction.user.id);

    const questions = session.questions || [];
    if (!session.gameLink && questions.length < 2) {
        const msg = { content: '❌ Need at least 2 questions.', flags: 64 };
        return interaction.replied || interaction.deferred ? interaction.editReply(msg) : interaction.reply(msg);
    }

    const form = await AppForm.create({
        name: session.name, description: session.description,
        department: session.department || 'General',
        gameLink: session.gameLink || null, questions,
        createdBy: session.createdBy, createdByTag: session.createdByTag,
        logServerId: session.logServerId, logServerName: session.logServerName,
        logChannelId: session.logChannelId, logChannelName: session.logChannelName,
        ticketServerId: session.ticketServerId, ticketServerName: session.ticketServerName,
        ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
        notifyRoleId: session.notifyRoleId || '1480839573390233702',
        createdAt: new Date(), open: false
    });

    // Split questions into chunks that fit within Discord's 1024-char field limit
    const qLines = questions.map((q, i) => `**${i + 1}.** ${q}`);
    const qChunks = [];
    let chunk = '';
    for (const line of qLines) {
        if ((chunk + '\n' + line).length > 1020) { qChunks.push(chunk); chunk = line; }
        else chunk = chunk ? chunk + '\n' + line : line;
    }
    if (chunk) qChunks.push(chunk);

    // Build a short tip showing any typed questions with their detected type
    const typeTips = questions.map((q, i) => {
        const { type, display } = parseQuestion(q);
        const tag = type === 'scale' ? '`[SCALE]`' : type === 'choice' ? '`[CHOICE]`' : '`Text`';
        return `${tag} **Q${i + 1}:** ${display.slice(0, 60)}${display.length > 60 ? '…' : ''}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('✅ Application Form Created')
        .setColor(0x57f287)
        .addFields(
            { name: 'Form Name', value: form.name, inline: true },
            { name: 'Department', value: form.department || 'General', inline: true },
            ...qChunks.map((c, i) => ({ name: i === 0 ? 'Questions' : '​', value: c })),
            { name: '📌 Question Types Detected', value: typeTips || '*(none)*' },
            { name: 'Log Channel', value: `#${form.logChannelName} in **${form.logServerName}**`, inline: true },
            { name: 'Ticket Channel', value: `#${form.ticketChannelName} in **${form.ticketServerName}**`, inline: true },
            { name: 'Notify Role', value: `<@&${form.notifyRoleId}>`, inline: true }
        )
        .setFooter({ text: 'Use /application open to post the Apply button' });

    const payload = { embeds: [embed], content: null, components: [], flags: 64 };
    if (interaction.deferred) return interaction.editReply(payload);
    if (interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
}

// ─── Shared finish-open logic ────────────────────────────────────────────────

async function finishOpen(interaction, session, channelId, client) {
    const { AppForm } = require('../db');
    pendingOpens.delete(interaction.user.id);

    // Helper: reply works for both select menus (update) and modal submits (reply/editReply)
    const replyOrUpdate = (payload) => {
        if (interaction.isModalSubmit()) return interaction.reply({ ...payload, flags: 64 });
        return interaction.update(payload);
    };

    const targetChannel = await client.channels.fetch(channelId).catch(() => null);
    if (!targetChannel) return replyOrUpdate({ content: `❌ Couldn't find channel \`${channelId}\`. Make sure the ID is correct and the bot is in that server.`, embeds: [], components: [] });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_apply_${session.formId}`)
            .setLabel('Apply Now 📝')
            .setStyle(ButtonStyle.Primary)
    );

    let openMessageId;
    if (session.messageId) {
        const existing = await targetChannel.messages.fetch(session.messageId).catch(() => null);
        if (!existing) return replyOrUpdate({ content: `❌ Couldn't find message \`${session.messageId}\` in <#${channelId}>. Double-check the message ID.`, embeds: [], components: [] });
        if (existing.author.id !== client.user.id) return replyOrUpdate({ content: `❌ That message wasn't sent by me — I can only add buttons to my own messages. Use the regular flow to post a fresh Apply button instead.`, embeds: [], components: [] });
        await existing.edit({ components: [row] });
        openMessageId = session.messageId;
    } else {
        const msg = await targetChannel.send({
            content: `> 📝 **${session.formName}**${session.formDesc ? ` — ${session.formDesc}` : ''}\n> Click below to apply. Make sure your DMs are open!`,
            components: [row]
        });
        openMessageId = msg.id;
    }

    await AppForm.findByIdAndUpdate(session.formId, { open: true, openMessageId, openChannelId: channelId });
    await refreshStatusBoard(client);

    return replyOrUpdate({ content: `✅ **${session.formName}** is now open! Apply button posted in <#${channelId}>.`, embeds: [], components: [] });
}