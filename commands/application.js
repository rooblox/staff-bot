const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits
} = require('discord.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str, max = 1024) {
    if (!str) return '*None*';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

// Search guilds the bot is in — returns array of { id, name }
function searchGuilds(client, query) {
    const q = query.toLowerCase().trim();
    if (!q) return [...client.guilds.cache.values()].slice(0, 25).map(g => ({ id: g.id, name: g.name }));
    return [...client.guilds.cache.values()]
        .filter(g => g.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map(g => ({ id: g.id, name: g.name }));
}

// Search text channels in a guild — works from cache if already fetched, fetches otherwise
async function searchChannels(client, guildId, query) {
    try {
        let guild = client.guilds.cache.get(guildId);
        if (!guild) guild = await client.guilds.fetch(guildId);
        if (!guild) return [];
        // Ensure channel cache is populated
        if (guild.channels.cache.size === 0) await guild.channels.fetch();
        const q = query.toLowerCase().trim();
        return [...guild.channels.cache.values()]
            .filter(c => {
                if (!c || !c.name) return false;
                if (!c.isTextBased()) return false;
                if (c.isThread && c.isThread()) return false;
                return !q || c.name.toLowerCase().includes(q);
            })
            .slice(0, 25)
            .map(c => ({ id: c.id, name: `#${c.name}` }));
    } catch (err) {
        console.error('[searchChannels error]', err);
        return [];
    }
}

// ─── In-memory pending DM sessions ──────────────────────────────────────────
// userId -> { formId, formName, answers: [], questionIndex, isResubmit, questions }
const pendingDMs = new Map();

// ─── In-memory setup sessions (waiting for modal submit) ────────────────────
// userId -> { name, logServerId, logServerName, logChannelId, logChannelName,
//             ticketServerId, ticketServerName, ticketChannelId, ticketChannelName, description }
const pendingSetups = new Map();

module.exports = {
    pendingDMs,
    pendingSetups,

    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Application form system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        // ── SETUP (step 1: pick servers/channels, then modal for questions) ──
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Create a new application form')
            .addStringOption(o => o.setName('name').setDescription('Name for this form e.g. "Barista Application"').setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName('log_server').setDescription('Part of the server name to log submissions in').setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName('log_channel').setDescription('Part of the channel name to log submissions in').setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName('ticket_server').setDescription('Part of the server name where applicants open tickets').setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName('ticket_channel').setDescription('Part of the channel name where tickets are opened').setRequired(true).setMaxLength(100))
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

            // ── SETUP ──
            if (sub === 'setup') {
                const name           = interaction.options.getString('name');
                const logServerQ     = interaction.options.getString('log_server');
                const logChannelQ    = interaction.options.getString('log_channel');
                const ticketServerQ  = interaction.options.getString('ticket_server');
                const ticketChannelQ = interaction.options.getString('ticket_channel');
                const description    = interaction.options.getString('description') || '';

                // Resolve log server
                const logGuilds = searchGuilds(client, logServerQ);
                if (!logGuilds.length) {
                    const all = searchGuilds(client, '').map(g => `• **${g.name}**`).join('\n');
                    return interaction.reply({ ephemeral: true, content: `❌ No server found matching **"${logServerQ}"**.\n\nServers the bot is in:\n${all || 'None'}` });
                }
                if (logGuilds.length > 5) {
                    return interaction.reply({ ephemeral: true, content: `⚠️ "${logServerQ}" matches multiple servers. Be more specific:\n${logGuilds.slice(0,10).map(g=>`• **${g.name}**`).join('\n')}` });
                }
                const logGuild = logGuilds[0];

                // Resolve ticket server
                const ticketGuilds = searchGuilds(client, ticketServerQ);
                if (!ticketGuilds.length) {
                    const all = searchGuilds(client, '').map(g => `• **${g.name}**`).join('\n');
                    return interaction.reply({ ephemeral: true, content: `❌ No server found matching **"${ticketServerQ}"**.\n\nServers the bot is in:\n${all || 'None'}` });
                }
                if (ticketGuilds.length > 5) {
                    return interaction.reply({ ephemeral: true, content: `⚠️ "${ticketServerQ}" matches multiple servers. Be more specific:\n${ticketGuilds.slice(0,10).map(g=>`• **${g.name}**`).join('\n')}` });
                }
                const ticketGuild = ticketGuilds[0];

                // Resolve log channel
                const logChannels = await searchChannels(client, logGuild.id, logChannelQ);
                if (!logChannels.length) {
                    const all = await searchChannels(client, logGuild.id, '');
                    return interaction.reply({ ephemeral: true, content: `❌ No channel matching **"${logChannelQ}"** in **${logGuild.name}**.\n\nChannels available:\n${all.map(c=>`• ${c.name}`).join('\n') || 'None visible'}` });
                }
                if (logChannels.length > 5) {
                    return interaction.reply({ ephemeral: true, content: `⚠️ Multiple channels match "${logChannelQ}" in **${logGuild.name}**. Be more specific:\n${logChannels.map(c=>`• ${c.name}`).join('\n')}` });
                }
                const logChannel = logChannels[0];

                // Resolve ticket channel
                const ticketChannels = await searchChannels(client, ticketGuild.id, ticketChannelQ);
                if (!ticketChannels.length) {
                    const all = await searchChannels(client, ticketGuild.id, '');
                    return interaction.reply({ ephemeral: true, content: `❌ No channel matching **"${ticketChannelQ}"** in **${ticketGuild.name}**.\n\nChannels available:\n${all.map(c=>`• ${c.name}`).join('\n') || 'None visible'}` });
                }
                if (ticketChannels.length > 5) {
                    return interaction.reply({ ephemeral: true, content: `⚠️ Multiple channels match "${ticketChannelQ}" in **${ticketGuild.name}**. Be more specific:\n${ticketChannels.map(c=>`• ${c.name}`).join('\n')}` });
                }
                const ticketChannel = ticketChannels[0];

                // Save setup context then show the questions modal
                pendingSetups.set(interaction.user.id, {
                    name, description,
                    logServerId: logGuild.id, logServerName: logGuild.name,
                    logChannelId: logChannel.id, logChannelName: logChannel.name.replace(/^#/, ''),
                    ticketServerId: ticketGuild.id, ticketServerName: ticketGuild.name,
                    ticketChannelId: ticketChannel.id, ticketChannelName: ticketChannel.name.replace(/^#/, ''),
                    createdBy: interaction.user.id, createdByTag: interaction.user.tag
                });

                const modal = new ModalBuilder()
                    .setCustomId('app_setup_questions')
                    .setTitle(`Questions for: ${name.slice(0, 40)}`);

                const q1 = new TextInputBuilder().setCustomId('q1').setLabel('Question 1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('e.g. What is your Roblox username?');
                const q2 = new TextInputBuilder().setCustomId('q2').setLabel('Question 2').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('e.g. How old are you?');
                const q3 = new TextInputBuilder().setCustomId('q3').setLabel('Question 3 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setPlaceholder('e.g. Why do you want to join?');
                const q4 = new TextInputBuilder().setCustomId('q4').setLabel('Question 4 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200);
                const q5 = new TextInputBuilder().setCustomId('q5').setLabel('Question 5 (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(q1),
                    new ActionRowBuilder().addComponents(q2),
                    new ActionRowBuilder().addComponents(q3),
                    new ActionRowBuilder().addComponents(q4),
                    new ActionRowBuilder().addComponents(q5)
                );

                return interaction.showModal(modal);
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
                const formSearch   = interaction.options.getString('form_search').toLowerCase().trim();
                const channelSearch = interaction.options.getString('channel_search').toLowerCase().trim();
                const messageId    = interaction.options.getString('message_id');

                const forms = await AppForm.find();
                const matchedForms = forms.filter(f => f.name.toLowerCase().includes(formSearch));
                if (!matchedForms.length) {
                    return interaction.editReply({ content: `❌ No form found matching **"${formSearch}"**.\n\nAvailable:\n${forms.map(f=>`• **${f.name}**`).join('\n') || 'None yet.'}` });
                }
                if (matchedForms.length > 1) {
                    return interaction.editReply({ content: `⚠️ Multiple forms match "${formSearch}". Be more specific:\n${matchedForms.map(f=>`• **${f.name}**`).join('\n')}` });
                }
                const form = matchedForms[0];

                const channels = await searchChannels(client, interaction.guild.id, channelSearch);
                if (!channels.length) {
                    const all = await searchChannels(client, interaction.guild.id, '');
                    return interaction.editReply({ content: `❌ No channel matching **"${channelSearch}"** in this server.\n\nAvailable:\n${all.map(c=>`• ${c.name}`).join('\n') || 'None visible'}` });
                }
                if (channels.length > 5) {
                    return interaction.editReply({ content: `⚠️ Multiple channels match "${channelSearch}". Be more specific:\n${channels.map(c=>`• ${c.name}`).join('\n')}` });
                }
                const targetChannel = await client.channels.fetch(channels[0].id);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_apply_${form._id}`)
                        .setLabel('Apply Now 📝')
                        .setStyle(ButtonStyle.Primary)
                );

                let openMessageId;

                if (messageId) {
                    const existing = await targetChannel.messages.fetch(messageId).catch(() => null);
                    if (!existing) return interaction.editReply({ content: `❌ Couldn't find that message in ${targetChannel}. Check the message ID is from that channel.` });
                    if (existing.author.id !== client.user.id) return interaction.editReply({ content: `❌ I can only edit my own messages. Skip the \`message_id\` option and I'll post a small button message below the requirements instead.` });
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
                if (!matched.length) return interaction.editReply({ content: `❌ No form found matching "${q}".\n\nAvailable:\n${forms.map(f=>`• **${f.name}**`).join('\n') || 'None'}` });
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches. Be more specific:\n${matched.map(f=>`• **${f.name}**`).join('\n')}` });

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
                if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches. Be more specific:\n${matched.map(f=>`• **${f.name}**`).join('\n')}` });

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

    // ── Handle the questions modal submit ───────────────────────────────────
    // Call this from index.js in the isModalSubmit() block:
    //   if (interaction.customId === 'app_setup_questions') { await require('./commands/application').handleSetupModal(interaction); return; }
    async handleSetupModal(interaction) {
        try {
            const { AppForm } = require('../db');
            const setup = pendingSetups.get(interaction.user.id);
            if (!setup) {
                return interaction.reply({ content: '❌ Setup session expired. Run `/application setup` again.', ephemeral: true });
            }
            pendingSetups.delete(interaction.user.id);

            const questions = [
                interaction.fields.getTextInputValue('q1'),
                interaction.fields.getTextInputValue('q2'),
                interaction.fields.getTextInputValue('q3'),
                interaction.fields.getTextInputValue('q4'),
                interaction.fields.getTextInputValue('q5'),
            ].filter(q => q && q.trim());

            if (questions.length < 2) {
                return interaction.reply({ content: '❌ Please add at least 2 questions.', ephemeral: true });
            }

            const form = await AppForm.create({
                ...setup,
                questions,
                createdAt: new Date(),
                open: false
            });

            await interaction.reply({
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