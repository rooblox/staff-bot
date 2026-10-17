const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits,
    StringSelectMenuBuilder
} = require('discord.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

// Get all guilds bot is in as select options
function guildOptions(client) {
    return [...client.guilds.cache.values()]
        .slice(0, 25)
        .map(g => ({ label: g.name.slice(0, 100), value: g.id }));
}

// Get text channels for a guild as select options
async function channelOptions(client, guildId) {
    try {
        let guild = client.guilds.cache.get(guildId);
        if (!guild) guild = await client.guilds.fetch(guildId);
        if (guild.channels.cache.size === 0) await guild.channels.fetch();
        return [...guild.channels.cache.values()]
            .filter(c => c && c.name && c.isTextBased() && !(c.isThread && c.isThread()))
            .slice(0, 25)
            .map(c => ({ label: `#${c.name}`.slice(0, 100), value: c.id }));
    } catch { return []; }
}

// ─── In-memory pending DM sessions ──────────────────────────────────────────
// userId -> { formId, formName, answers: [], questionIndex, isResubmit, questions }
const pendingDMs = new Map();

// ─── In-memory setup sessions ────────────────────────────────────────────────
// userId -> { step, name, description, logServerId, logServerName,
//             logChannelId, logChannelName, ticketServerId, ticketServerName,
//             ticketChannelId, ticketChannelName }
const pendingSetups = new Map();

// ─── Build the step embeds/selects ──────────────────────────────────────────

function stepEmbed(title, desc) {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .setDescription(desc);
}

async function sendStep(interaction, session, isUpdate = false) {
    const client = interaction.client;
    const uid = interaction.user.id;

    let embed, components;

    if (session.step === 'log_server') {
        const opts = guildOptions(client);
        embed = stepEmbed('Step 1 of 4 — Log Server', 'Which server should submissions be logged in?');
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_logserver_${uid}`)
                .setPlaceholder('Select a server…')
                .addOptions(opts)
        )];
    } else if (session.step === 'log_channel') {
        const opts = await channelOptions(client, session.logServerId);
        if (!opts.length) {
            const msg = { content: `❌ No text channels visible in **${session.logServerName}**. Check bot permissions.`, ephemeral: true };
            return isUpdate ? interaction.update(msg) : interaction.reply(msg);
        }
        embed = stepEmbed('Step 2 of 4 — Log Channel', `Which channel in **${session.logServerName}** should submissions post to?`);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_logchannel_${uid}`)
                .setPlaceholder('Select a channel…')
                .addOptions(opts)
        )];
    } else if (session.step === 'ticket_server') {
        const opts = guildOptions(client);
        embed = stepEmbed('Step 3 of 4 — Ticket Server', `Log channel set to **#${session.logChannelName}** in **${session.logServerName}**.\n\nWhich server should applicants open support tickets in?`);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_ticketserver_${uid}`)
                .setPlaceholder('Select a server…')
                .addOptions(opts)
        )];
    } else if (session.step === 'ticket_channel') {
        const opts = await channelOptions(client, session.ticketServerId);
        if (!opts.length) {
            const msg = { content: `❌ No text channels visible in **${session.ticketServerName}**. Check bot permissions.`, ephemeral: true };
            return isUpdate ? interaction.update(msg) : interaction.reply(msg);
        }
        embed = stepEmbed('Step 4 of 4 — Ticket Channel', `Which channel in **${session.ticketServerName}** should applicants open tickets in?`);
        components = [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`appsetup_ticketchannel_${uid}`)
                .setPlaceholder('Select a channel…')
                .addOptions(opts)
        )];
    }

    const payload = { embeds: [embed], components, ephemeral: true };
    if (isUpdate) return interaction.update(payload);
    return interaction.reply(payload);
}

// ─── Module exports ──────────────────────────────────────────────────────────

module.exports = {
    pendingDMs,
    pendingSetups,

    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Application form system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        // ── SETUP ──
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Create a new application form')
            .addStringOption(o => o.setName('name').setDescription('Name for this form e.g. "Barista Application"').setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName('description').setDescription('Optional description shown on the apply message').setRequired(false).setMaxLength(200))
        )

        // ── LIST ──
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all application forms')
        )

        // ── OPEN ──
        .addSubcommand(sub => sub
            .setName('open')
            .setDescription('Post an Apply button for a form in a channel')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name e.g. "barista"').setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName('channel_search').setDescription('Part of the channel name e.g. "applications"').setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName('message_id').setDescription('Paste a message ID to attach the button to an existing bot message').setRequired(false))
        )

        // ── CLOSE ──
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close a form and remove its Apply button')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        )

        // ── DELETE ──
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an application form permanently')
            .addStringOption(o => o.setName('form_search').setDescription('Part of the form name').setRequired(true).setMaxLength(80))
        ),

    async execute(interaction) {
        try {
            const { AppForm } = require('../db');
            const sub = interaction.options.getSubcommand();
            const client = interaction.client;

            // ── SETUP — kick off the dropdown flow ──
            if (sub === 'setup') {
                const name = interaction.options.getString('name');
                const description = interaction.options.getString('description') || '';

                const session = {
                    step: 'log_server',
                    name, description,
                    createdBy: interaction.user.id,
                    createdByTag: interaction.user.tag
                };
                pendingSetups.set(interaction.user.id, session);
                return sendStep(interaction, session, false);
            }

            // ── LIST ──
            if (sub === 'list') {
                const forms = await AppForm.find().sort({ createdAt: -1 }).limit(20);
                if (!forms.length) return interaction.reply({ content: '❌ No application forms yet. Use `/application setup` to create one.', ephemeral: true });
                const embed = new EmbedBuilder()
                    .setTitle('📋 Application Forms')
                    .setColor(0x5865f2)
                    .setDescription(forms.map(f =>
                        `**${f.name}**\n` +
                        `${f.questions.length} questions · Log: #${f.logChannelName} in ${f.logServerName} · ${f.open ? '🟢 Open' : '🔴 Closed'}`
                    ).join('\n\n'));
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── OPEN ──
            if (sub === 'open') {
                await interaction.deferReply({ ephemeral: true });
                const formSearch    = interaction.options.getString('form_search').toLowerCase().trim();
                const channelSearch = interaction.options.getString('channel_search').toLowerCase().trim();
                const messageId     = interaction.options.getString('message_id');

                const forms = await AppForm.find();
                const matchedForms = forms.filter(f => f.name.toLowerCase().includes(formSearch));
                if (!matchedForms.length) {
                    return interaction.editReply({ content: `❌ No form found matching **"${formSearch}"**.\n\nAvailable:\n${forms.map(f => `• **${f.name}**`).join('\n') || 'None yet.'}` });
                }
                if (matchedForms.length > 1) {
                    return interaction.editReply({ content: `⚠️ Multiple forms match "${formSearch}". Be more specific:\n${matchedForms.map(f => `• **${f.name}**`).join('\n')}` });
                }
                const form = matchedForms[0];

                // Search channels in current guild
                const opts = await channelOptions(client, interaction.guild.id);
                const matched = opts.filter(c => c.label.toLowerCase().includes(channelSearch));
                if (!matched.length) {
                    return interaction.editReply({ content: `❌ No channel matching **"${channelSearch}"** in this server.\n\nAvailable:\n${opts.map(c => `• ${c.label}`).join('\n') || 'None visible'}` });
                }
                if (matched.length > 5) {
                    return interaction.editReply({ content: `⚠️ Multiple channels match "${channelSearch}". Be more specific:\n${matched.map(c => `• ${c.label}`).join('\n')}` });
                }
                const targetChannel = await client.channels.fetch(matched[0].value);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_apply_${form._id}`)
                        .setLabel('Apply Now 📝')
                        .setStyle(ButtonStyle.Primary)
                );

                let openMessageId;
                if (messageId) {
                    const existing = await targetChannel.messages.fetch(messageId).catch(() => null);
                    if (!existing) return interaction.editReply({ content: `❌ Couldn't find that message in ${targetChannel}.` });
                    if (existing.author.id !== client.user.id) return interaction.editReply({ content: `❌ I can only edit my own messages. Skip \`message_id\` and I'll post a button message below your requirements instead.` });
                    await existing.edit({ components: [row] });
                    openMessageId = messageId;
                    await interaction.editReply({ content: `✅ Apply button added to the existing message in ${targetChannel}!` });
                } else {
                    const msg = await targetChannel.send({
                        content: `> 📝 **${form.name}**${form.description ? ` — ${form.description}` : ''}\n> Click below to apply. Make sure your DMs are open!`,
                        components: [row]
                    });
                    openMessageId = msg.id;
                    await interaction.editReply({ content: `✅ Apply button posted in ${targetChannel}!` });
                }

                await AppForm.findByIdAndUpdate(form._id, { open: true, openMessageId, openChannelId: targetChannel.id });
                return;
            }

            // ── CLOSE ──
            if (sub === 'close') {
                await interaction.deferReply({ ephemeral: true });
                const q = interaction.options.getString('form_search').toLowerCase().trim();
                const forms = await AppForm.find();
                const matched = forms.filter(f => f.name.toLowerCase().includes(q));
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".\n\nAvailable:\n${forms.map(f => `• **${f.name}**`).join('\n') || 'None'}` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches. Be more specific:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });

                const form = matched[0];
                await AppForm.findByIdAndUpdate(form._id, { open: false });

                if (form.openMessageId && form.openChannelId) {
                    try {
                        const ch = await client.channels.fetch(form.openChannelId);
                        const msg = await ch.messages.fetch(form.openMessageId);
                        if (msg.author.id === client.user.id) await msg.edit({ components: [] });
                    } catch {}
                }
                return interaction.editReply({ content: `✅ **${form.name}** is now closed. Apply button removed.` });
            }

            // ── DELETE ──
            if (sub === 'delete') {
                await interaction.deferReply({ ephemeral: true });
                const q = interaction.options.getString('form_search').toLowerCase().trim();
                const forms = await AppForm.find();
                const matched = forms.filter(f => f.name.toLowerCase().includes(q));
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches. Be more specific:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });

                const form = matched[0];
                await AppForm.findByIdAndDelete(form._id);
                return interaction.editReply({ content: `✅ Application form **${form.name}** deleted.` });
            }

        } catch (err) {
            console.error('[application execute error]', err);
            const msg = { content: '❌ Something went wrong. Check the bot logs.', ephemeral: true };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        }
    },

    // ── Handle all setup select menu interactions ────────────────────────────
    // Wire into index.js isStringSelectMenu() block:
    //   if (interaction.customId.startsWith('appsetup_')) { await require('./commands/application').handleSetupSelect(interaction); return; }
    async handleSetupSelect(interaction) {
        try {
            const uid = interaction.user.id;
            const session = pendingSetups.get(uid);
            if (!session) {
                return interaction.update({ content: '❌ Setup session expired. Run `/application setup` again.', embeds: [], components: [] });
            }

            const id = interaction.customId;
            const value = interaction.values[0];
            const client = interaction.client;

            if (id === `appsetup_logserver_${uid}`) {
                const guild = client.guilds.cache.get(value);
                session.logServerId = value;
                session.logServerName = guild ? guild.name : value;
                session.step = 'log_channel';
                return sendStep(interaction, session, true);
            }

            if (id === `appsetup_logchannel_${uid}`) {
                const guild = client.guilds.cache.get(session.logServerId);
                const ch = guild ? guild.channels.cache.get(value) : null;
                session.logChannelId = value;
                session.logChannelName = ch ? ch.name : value;
                session.step = 'ticket_server';
                return sendStep(interaction, session, true);
            }

            if (id === `appsetup_ticketserver_${uid}`) {
                const guild = client.guilds.cache.get(value);
                session.ticketServerId = value;
                session.ticketServerName = guild ? guild.name : value;
                session.step = 'ticket_channel';
                return sendStep(interaction, session, true);
            }

            if (id === `appsetup_ticketchannel_${uid}`) {
                const guild = client.guilds.cache.get(session.ticketServerId);
                const ch = guild ? guild.channels.cache.get(value) : null;
                session.ticketChannelId = value;
                session.ticketChannelName = ch ? ch.name : value;
                // All server/channel info collected — show questions modal
                const modal = new ModalBuilder()
                    .setCustomId('app_setup_questions')
                    .setTitle(`Questions: ${session.name.slice(0, 40)}`);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('q1').setLabel('Question 1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('e.g. What is your Roblox username?')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('q2').setLabel('Question 2').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('e.g. How old are you?')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('q3').setLabel('Question 3 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setPlaceholder('e.g. Why do you want to join?')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('q4').setLabel('Question 4 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('q5').setLabel('Question 5 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
                    )
                );

                return interaction.showModal(modal);
            }

        } catch (err) {
            console.error('[appsetup select error]', err);
            await interaction.update({ content: '❌ Something went wrong. Try `/application setup` again.', embeds: [], components: [] }).catch(() => {});
        }
    },

    // ── Handle the questions modal submit ───────────────────────────────────
    // Wire into index.js isModalSubmit() block:
    //   if (interaction.customId === 'app_setup_questions') { await require('./commands/application').handleSetupModal(interaction); return; }
    async handleSetupModal(interaction) {
        try {
            const { AppForm } = require('../db');
            const session = pendingSetups.get(interaction.user.id);
            if (!session) {
                return interaction.reply({ content: '❌ Setup session expired. Run `/application setup` again.', ephemeral: true });
            }
            pendingSetups.delete(interaction.user.id);

            const questions = ['q1','q2','q3','q4','q5']
                .map(k => interaction.fields.getTextInputValue(k))
                .filter(q => q && q.trim());

            if (questions.length < 2) {
                return interaction.reply({ content: '❌ Please add at least 2 questions.', ephemeral: true });
            }

            const form = await AppForm.create({
                name: session.name,
                description: session.description,
                questions,
                createdBy: session.createdBy,
                createdByTag: session.createdByTag,
                logServerId: session.logServerId,
                logServerName: session.logServerName,
                logChannelId: session.logChannelId,
                logChannelName: session.logChannelName,
                ticketServerId: session.ticketServerId,
                ticketServerName: session.ticketServerName,
                ticketChannelId: session.ticketChannelId,
                ticketChannelName: session.ticketChannelName,
                createdAt: new Date(),
                open: false
            });

            return interaction.reply({
                ephemeral: true,
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Application Form Created')
                    .setColor(0x57f287)
                    .addFields(
                        { name: 'Form Name', value: form.name, inline: true },
                        { name: 'Questions', value: questions.map((q, i) => `**${i + 1}.** ${q}`).join('\n') },
                        { name: 'Log Channel', value: `#${form.logChannelName} in **${form.logServerName}**`, inline: true },
                        { name: 'Ticket Channel', value: `#${form.ticketChannelName} in **${form.ticketServerName}**`, inline: true }
                    )
                    .setFooter({ text: 'Use /application open to post the Apply button' })]
            });
        } catch (err) {
            console.error('[app_setup_questions modal error]', err);
            await interaction.reply({ content: '❌ Failed to save the form. Check the bot logs.', ephemeral: true }).catch(() => {});
        }
    }
};