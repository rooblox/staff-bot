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
const pendingDMs    = new Map(); // userId -> DM application flow
const pendingSetups = new Map(); // userId -> setup wizard session
const pendingOpens  = new Map(); // userId -> open wizard session

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
        embed = stepEmbed('Step 4 of 4 — Ticket Channel',
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
    }

    const payload = { embeds: [embed], components, ephemeral: true };
    if (isUpdate) return interaction.update(payload);
    return interaction.reply(payload);
}

// round: 1, 2, or 3  (questions 1-5, 6-10, 11-15)
function questionsModal(name, round = 1, customId = 'app_setup_questions_1') {
    const base  = (round - 1) * 5; // 0, 5, 10
    const req   = round === 1;
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`Questions ${base + 1}–${base + 5}: ${name.slice(0, 30)}`);
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
                    num === 2 ? 'e.g. Why do you want to join?' : ''
                )
        ));
    }
    return modal;
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
            const msg = { content: '❌ No forms yet. Use `/application setup` first.', ephemeral: true };
            return isUpdate ? interaction.update(msg) : interaction.reply(msg);
        }
        embed = stepEmbed('Open — Step 1 of 2', 'Which form do you want to open?');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appopen_form_${uid}`)
                .setPlaceholder('Select a form…')
                .addOptions(forms.map(f => ({ label: f.name.slice(0, 100), value: String(f._id), description: `${f.questions.length} questions · ${f.open ? 'Currently open' : 'Closed'}` })))
        )];

    } else if (session.step === 'pick_channel') {
        const opts = await channelOptions(client, interaction.guild.id);
        embed = stepEmbed('Open — Step 2 of 2',
            `Form: **${session.formName}** ✅\n\nWhich channel should the Apply button be posted in?`);
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
            manualIdButton(`appopen_channel_manual_${uid}`, '📋 Enter channel ID manually')
        ));
    }

    const payload = { embeds: [embed], components, ephemeral: true };
    if (isUpdate) return interaction.update(payload);
    return interaction.reply(payload);
}

// ─── Module ──────────────────────────────────────────────────────────────────

module.exports = {
    pendingDMs,
    pendingSetups,
    pendingOpens,

    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Application form system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Create a new application form')
            .addStringOption(o => o.setName('name').setDescription('Name for this form e.g. "Barista Application"').setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName('description').setDescription('Optional description shown on the apply message').setRequired(false).setMaxLength(200))
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all application forms')
        )
        .addSubcommand(sub => sub
            .setName('open')
            .setDescription('Post an Apply button — select form and channel via dropdowns')
            .addStringOption(o => o.setName('message_id').setDescription('Optional: attach to an existing bot message instead of posting a new one').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close a form and remove its Apply button')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an application form permanently')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        ),

    async execute(interaction) {
        try {
            const { AppForm } = require('../db');
            const sub    = interaction.options.getSubcommand();
            const client = interaction.client;

            if (sub === 'setup') {
                const session = {
                    step: 'log_server',
                    name: interaction.options.getString('name'),
                    description: interaction.options.getString('description') || '',
                    createdBy: interaction.user.id,
                    createdByTag: interaction.user.tag
                };
                pendingSetups.set(interaction.user.id, session);
                return sendSetupStep(interaction, session, false);
            }

            if (sub === 'list') {
                const forms = await AppForm.find().sort({ createdAt: -1 }).limit(20);
                if (!forms.length) return interaction.reply({ content: '❌ No application forms yet. Use `/application setup` to create one.', ephemeral: true });
                const embed = new EmbedBuilder()
                    .setTitle('📋 Application Forms')
                    .setColor(0x5865f2)
                    .setDescription(forms.map(f =>
                        `**${f.name}**\n${f.questions.length} questions · Log: #${f.logChannelName} in ${f.logServerName} · ${f.open ? '🟢 Open' : '🔴 Closed'}`
                    ).join('\n\n'));
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (sub === 'open') {
                const messageId = interaction.options.getString('message_id') || null;
                const session = { step: 'pick_form', messageId };
                pendingOpens.set(interaction.user.id, session);
                return sendOpenStep(interaction, session, false);
            }

            if (sub === 'close') {
                await interaction.deferReply({ ephemeral: true });
                const q      = interaction.options.getString('form_search').toLowerCase().trim();
                const forms  = await AppForm.find();
                const matched = forms.filter(f => f.name.toLowerCase().includes(q));
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".\n\nAvailable:\n${forms.map(f => `• **${f.name}**`).join('\n') || 'None'}` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });
                const form = matched[0];
                await AppForm.findByIdAndUpdate(form._id, { open: false });
                if (form.openMessageId && form.openChannelId) {
                    try {
                        const ch  = await client.channels.fetch(form.openChannelId);
                        const msg = await ch.messages.fetch(form.openMessageId);
                        if (msg.author.id === client.user.id) await msg.edit({ components: [] });
                    } catch {}
                }
                return interaction.editReply({ content: `✅ **${form.name}** closed. Apply button removed.` });
            }

            if (sub === 'delete') {
                await interaction.deferReply({ ephemeral: true });
                const q      = interaction.options.getString('form_search').toLowerCase().trim();
                const forms  = await AppForm.find();
                const matched = forms.filter(f => f.name.toLowerCase().includes(q));
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });
                await AppForm.findByIdAndDelete(matched[0]._id);
                return interaction.editReply({ content: `✅ **${matched[0].name}** deleted.` });
            }

        } catch (err) {
            console.error('[application execute error]', err);
            const msg = { content: '❌ Something went wrong. Check the bot logs.', ephemeral: true };
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

            // ── Manual ID buttons (isButton) ──
            if (interaction.isButton()) {
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
                return interaction.showModal(questionsModal(session.name, 1, 'app_setup_questions_1'));
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
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', ephemeral: true });

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
                // Done — show questions modal (round 1)
                return interaction.showModal(questionsModal(session.name, 1, 'app_setup_questions_1'));
            }

            // Continue to next step
            return sendSetupStep(interaction, session, false);

        } catch (err) {
            console.error('[appsetup manualch error]', err);
            await interaction.reply({ content: '❌ Something went wrong. Try `/application setup` again.', ephemeral: true }).catch(() => {});
        }
    },

    // ── Questions modal submit (rounds 1–3, customId: app_setup_questions_1/2/3) ──
    // index.js: if (interaction.customId.startsWith('app_setup_questions_')) { await require('./commands/application').handleSetupModal(interaction); return; }
    async handleSetupModal(interaction) {
        try {
            const { AppForm } = require('../db');
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application setup` again.', ephemeral: true });

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
                return interaction.reply({ content: '❌ Please fill in at least 2 questions.', ephemeral: true });
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
                    ephemeral: true,
                    content: `Got **${session.questions.length}** question(s) so far. Add more or save now.`,
                    components: [new ActionRowBuilder().addComponents(addMoreBtn, doneBtn)]
                });
            }

            // Round 3 or at 15 — save immediately
            return saveForm(interaction, session);

        } catch (err) {
            console.error('[app_setup_questions modal error]', err);
            await interaction.reply({ content: '❌ Failed to save the form. Check the bot logs.', ephemeral: true }).catch(() => {});
        }
    },

    // ── "Add more questions" button + "Done" button ──────────────────────────
    // index.js: if (interaction.customId.startsWith('appsetup_addmore_') || interaction.customId.startsWith('appsetup_savequestions_')) { await require('./commands/application').handleSetupQuestionsButton(interaction); return; }
    async handleSetupQuestionsButton(interaction) {
        try {
            const uid     = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) return interaction.update({ content: '❌ Session expired. Run `/application setup` again.', embeds: [], components: [] });

            if (interaction.customId.startsWith('appsetup_savequestions_')) {
                await interaction.update({ content: 'Saving…', components: [] });
                return saveForm(interaction, session);
            }

            // appsetup_addmore_<round>_<uid>
            const round = parseInt(interaction.customId.split('_')[2]);
            await interaction.update({ content: `Opening questions ${(round - 1) * 5 + 1}–${round * 5}…`, components: [] });
            return interaction.followUp({ content: '​', ephemeral: true }).then(() =>
                interaction.showModal(questionsModal(session.name, round, `app_setup_questions_${round}`))
            ).catch(() =>
                interaction.showModal(questionsModal(session.name, round, `app_setup_questions_${round}`))
            );

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
                session.step     = 'pick_channel';
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
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/application open` again.', ephemeral: true });
            const chId   = interaction.fields.getTextInputValue('channel_id').trim();
            const client = interaction.client;
            await finishOpen(interaction, session, chId, client);
        } catch (err) {
            console.error('[appopen manual error]', err);
            await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
        }
    }
};

// ─── Shared save-form logic ──────────────────────────────────────────────────

async function saveForm(interaction, session) {
    const { AppForm } = require('../db');
    pendingSetups.delete(interaction.user.id);

    const questions = session.questions || [];
    if (questions.length < 2) {
        const msg = { content: '❌ Need at least 2 questions.', ephemeral: true };
        return interaction.replied || interaction.deferred ? interaction.editReply(msg) : interaction.reply(msg);
    }

    const form = await AppForm.create({
        name: session.name, description: session.description, questions,
        createdBy: session.createdBy, createdByTag: session.createdByTag,
        logServerId: session.logServerId, logServerName: session.logServerName,
        logChannelId: session.logChannelId, logChannelName: session.logChannelName,
        ticketServerId: session.ticketServerId, ticketServerName: session.ticketServerName,
        ticketChannelId: session.ticketChannelId, ticketChannelName: session.ticketChannelName,
        createdAt: new Date(), open: false
    });

    const embed = new EmbedBuilder()
        .setTitle('✅ Application Form Created')
        .setColor(0x57f287)
        .addFields(
            { name: 'Form Name', value: form.name, inline: true },
            { name: 'Questions', value: questions.map((q, i) => `**${i + 1}.** ${q}`).join('\n') },
            { name: 'Log Channel', value: `#${form.logChannelName} in **${form.logServerName}**`, inline: true },
            { name: 'Ticket Channel', value: `#${form.ticketChannelName} in **${form.ticketServerName}**`, inline: true }
        )
        .setFooter({ text: 'Use /application open to post the Apply button' });

    const payload = { embeds: [embed], content: null, components: [] };
    if (interaction.replied || interaction.deferred) return interaction.editReply({ ...payload, ephemeral: true });
    return interaction.reply({ ...payload, ephemeral: true });
}

// ─── Shared finish-open logic ────────────────────────────────────────────────

async function finishOpen(interaction, session, channelId, client) {
    const { AppForm } = require('../db');
    pendingOpens.delete(interaction.user.id);

    const targetChannel = await client.channels.fetch(channelId).catch(() => null);
    if (!targetChannel) return interaction.update({ content: `❌ Couldn't find channel \`${channelId}\`. Check the ID is correct and the bot is in that server.`, embeds: [], components: [] });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_apply_${session.formId}`)
            .setLabel('Apply Now 📝')
            .setStyle(ButtonStyle.Primary)
    );

    let openMessageId;
    if (session.messageId) {
        const existing = await targetChannel.messages.fetch(session.messageId).catch(() => null);
        if (!existing) return interaction.update({ content: `❌ Couldn't find message \`${session.messageId}\` in that channel.`, embeds: [], components: [] });
        if (existing.author.id !== client.user.id) return interaction.update({ content: `❌ I can only edit my own messages. Skip \`message_id\` to post a new button message instead.`, embeds: [], components: [] });
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

    const payload = { content: `✅ Apply button posted in <#${channelId}>!`, embeds: [], components: [] };
    if (interaction.isModalSubmit()) return interaction.reply({ ...payload, ephemeral: true });
    return interaction.update(payload);
}