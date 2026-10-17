const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits,
    StringSelectMenuBuilder
} = require('discord.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(str, max = 1024) {
    if (!str) return '*None*';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

// Search guilds the bot is in — returns array of { id, name }
async function searchGuilds(client, query) {
    const q = query.toLowerCase();
    return [...client.guilds.cache.values()]
        .filter(g => g.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map(g => ({ id: g.id, name: g.name }));
}

// Search text channels in a guild
async function searchChannels(client, guildId, query) {
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.channels.fetch();
        const q = query.toLowerCase();
        return [...guild.channels.cache.values()]
            .filter(c => c.isTextBased() && !c.isThread() && c.name.toLowerCase().includes(q))
            .slice(0, 25)
            .map(c => ({ id: c.id, name: `#${c.name}` }));
    } catch { return []; }
}

// ─── In-memory pending DM sessions ──────────────────────────────────────────
// userId -> { formId, answers: [], questionIndex, isResubmit, originalSubmissionId }
const pendingDMs = new Map();

module.exports = {
    pendingDMs,

    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Application form system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        // ── SETUP ──
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Create a new application form')
            .addStringOption(o => o.setName('name').setDescription('Name for this application (e.g. "Barista Application")').setRequired(true))
            .addStringOption(o => o.setName('questions').setDescription('Questions separated by | (e.g. "What is your age? | Why do you want to join? | Your Roblox username?")').setRequired(true))
            .addStringOption(o => o.setName('log_server_search').setDescription('Search for the server to log submissions in').setRequired(true))
            .addStringOption(o => o.setName('log_channel_search').setDescription('Search for the channel to log submissions in (after picking server)').setRequired(true))
            .addStringOption(o => o.setName('ticket_server_search').setDescription('Server where applicants open support tickets (for the "Open Ticket" button)').setRequired(true))
            .addStringOption(o => o.setName('ticket_channel_search').setDescription('Channel in that server where tickets are opened').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Optional description shown on the apply embed').setRequired(false))
        )

        // ── SEARCH (autocomplete helper shown as command) ──
        .addSubcommand(sub => sub
            .setName('search_server')
            .setDescription('Preview which server a search term finds (to help fill in setup)')
            .addStringOption(o => o.setName('query').setDescription('Server name to search').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('search_channel')
            .setDescription('Preview which channel a search term finds in a server')
            .addStringOption(o => o.setName('server_id').setDescription('Server ID').setRequired(true))
            .addStringOption(o => o.setName('query').setDescription('Channel name to search').setRequired(true))
        )

        // ── LIST ──
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all application forms')
        )

        // ── OPEN (post apply button publicly) ──
        .addSubcommand(sub => sub
            .setName('open')
            .setDescription('Attach an Apply button to a channel — search for the form and channel by name')
            .addStringOption(o => o.setName('form_search').setDescription('Search for the form by name (e.g. "barista")').setRequired(true))
            .addStringOption(o => o.setName('channel_search').setDescription('Search for the channel to post in by name (e.g. "applications")').setRequired(true))
            .addStringOption(o => o.setName('message_id').setDescription('Optional: paste a message ID to attach the button to an existing post instead of creating a new one').setRequired(false))
        )

        // ── CLOSE (remove apply button / mark closed) ──
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close an application form (disables the Apply button)')
            .addStringOption(o => o.setName('form_search').setDescription('Search for the form by name').setRequired(true))
        )

        // ── DELETE ──
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an application form')
            .addStringOption(o => o.setName('form_id').setDescription('Form ID (from /application list)').setRequired(true))
        ),

    async execute(interaction) {
        const { AppForm, AppSubmission } = require('./db');
        const sub = interaction.options.getSubcommand();
        const client = interaction.client;

        // ── SEARCH_SERVER ──
        if (sub === 'search_server') {
            const query = interaction.options.getString('query');
            const results = await searchGuilds(client, query);
            if (!results.length) return interaction.reply({ content: '❌ No servers found matching that name.', ephemeral: true });
            const list = results.map(g => `\`${g.id}\` — **${g.name}**`).join('\n');
            return interaction.reply({ content: `**Servers matching "${query}":**\n${list}`, ephemeral: true });
        }

        // ── SEARCH_CHANNEL ──
        if (sub === 'search_channel') {
            const guildId = interaction.options.getString('server_id');
            const query = interaction.options.getString('query');
            const results = await searchChannels(client, guildId, query);
            if (!results.length) return interaction.reply({ content: '❌ No channels found. Check the server ID is correct.', ephemeral: true });
            const list = results.map(c => `\`${c.id}\` — **${c.name}**`).join('\n');
            return interaction.reply({ content: `**Channels matching "${query}":**\n${list}`, ephemeral: true });
        }

        // ── SETUP ──
        if (sub === 'setup') {
            await interaction.deferReply({ ephemeral: true });

            const name = interaction.options.getString('name');
            const questionsRaw = interaction.options.getString('questions');
            const logServerSearch = interaction.options.getString('log_server_search');
            const logChannelSearch = interaction.options.getString('log_channel_search');
            const ticketServerSearch = interaction.options.getString('ticket_server_search');
            const ticketChannelSearch = interaction.options.getString('ticket_channel_search');
            const description = interaction.options.getString('description') || null;

            const questions = questionsRaw.split('|').map(q => q.trim()).filter(Boolean);
            if (questions.length === 0) return interaction.editReply({ content: '❌ No questions found. Separate them with `|`.' });
            if (questions.length > 10) return interaction.editReply({ content: '❌ Maximum 10 questions per form.' });

            // Resolve servers
            const logGuilds = await searchGuilds(client, logServerSearch);
            if (!logGuilds.length) return interaction.editReply({ content: `❌ No server found matching **"${logServerSearch}"**. Use \`/application search_server\` to preview results.` });

            const ticketGuilds = await searchGuilds(client, ticketServerSearch);
            if (!ticketGuilds.length) return interaction.editReply({ content: `❌ No server found matching **"${ticketServerSearch}"**.` });

            const logGuild = logGuilds[0];
            const ticketGuild = ticketGuilds[0];

            // Resolve channels
            const logChannels = await searchChannels(client, logGuild.id, logChannelSearch);
            if (!logChannels.length) return interaction.editReply({ content: `❌ No channel found matching **"${logChannelSearch}"** in **${logGuild.name}**.` });

            const ticketChannels = await searchChannels(client, ticketGuild.id, ticketChannelSearch);
            if (!ticketChannels.length) return interaction.editReply({ content: `❌ No channel found matching **"${ticketChannelSearch}"** in **${ticketGuild.name}**.` });

            const logChannel = logChannels[0];
            const ticketChannel = ticketChannels[0];

            const form = await AppForm.create({
                name,
                description,
                questions,
                createdBy: interaction.user.id,
                createdByTag: interaction.user.tag,
                logServerId: logGuild.id,
                logServerName: logGuild.name,
                logChannelId: logChannel.id,
                logChannelName: logChannel.name,
                ticketServerId: ticketGuild.id,
                ticketServerName: ticketGuild.name,
                ticketChannelId: ticketChannel.id,
                ticketChannelName: ticketChannel.name,
                createdAt: new Date(),
                open: false
            });

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Application Form Created')
                    .setColor(0x57f287)
                    .addFields(
                        { name: 'Form Name', value: name, inline: true },
                        { name: 'Form ID', value: `\`${form._id}\``, inline: true },
                        { name: 'Questions', value: questions.map((q, i) => `**${i + 1}.** ${q}`).join('\n') },
                        { name: 'Log Channel', value: `${logChannel.name} in **${logGuild.name}**`, inline: true },
                        { name: 'Ticket Channel', value: `${ticketChannel.name} in **${ticketGuild.name}**`, inline: true }
                    )
                    .setFooter({ text: `Use /application open ${form._id} to post it` })]
            });
        }

        // ── LIST ──
        if (sub === 'list') {
            const forms = await AppForm.find().sort({ createdAt: -1 }).limit(20);
            if (!forms.length) return interaction.reply({ content: '❌ No application forms created yet.', ephemeral: true });
            const embed = new EmbedBuilder()
                .setTitle('📋 Application Forms')
                .setColor(0x5865f2)
                .setDescription(forms.map(f =>
                    `**${f.name}** — \`${f._id}\`\n` +
                    `${f.questions.length} questions · Log: #${f.logChannelName} · ${f.open ? '🟢 Open' : '🔴 Closed'}`
                ).join('\n\n'));
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // ── OPEN ──
        if (sub === 'open') {
            await interaction.deferReply({ ephemeral: true });
            const formSearch = interaction.options.getString('form_search');
            const channelSearch = interaction.options.getString('channel_search');
            const messageId = interaction.options.getString('message_id');

            // Search forms by name
            const formQuery = formSearch.toLowerCase();
            const forms = await AppForm.find();
            const matchedForms = forms.filter(f => f.name.toLowerCase().includes(formQuery));
            if (!matchedForms.length) {
                return interaction.editReply({
                    content: `❌ No form found matching **"${formSearch}"**.\n\nAvailable forms:\n${forms.map(f => `• **${f.name}**`).join('\n') || 'None yet — use \`/application setup\` first.'}`
                });
            }
            if (matchedForms.length > 1) {
                return interaction.editReply({
                    content: `⚠️ Multiple forms match **"${formSearch}"**. Be more specific:\n${matchedForms.map(f => `• **${f.name}**`).join('\n')}`
                });
            }
            const form = matchedForms[0];

            // Search channels in the current guild
            const channels = await searchChannels(client, interaction.guild.id, channelSearch);
            if (!channels.length) {
                return interaction.editReply({ content: `❌ No channel found matching **"${channelSearch}"** in this server.` });
            }
            if (channels.length > 3) {
                return interaction.editReply({
                    content: `⚠️ Multiple channels match **"${channelSearch}"**. Be more specific:\n${channels.map(c => `• ${c.name}`).join('\n')}`
                });
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
                // Attach to existing message
                const existing = await targetChannel.messages.fetch(messageId).catch(() => null);
                if (!existing) {
                    return interaction.editReply({ content: `❌ Couldn't find that message in ${targetChannel}. Make sure the message ID is from that channel.` });
                }
                if (existing.author.id !== client.user.id) {
                    return interaction.editReply({ content: `❌ I can only edit my own messages. That message was posted by someone else.\n\nTo attach to a staff post the bot didn't write, post the requirements yourself first and skip the \`message_id\` option — I'll post a small button-only message right after.` });
                }
                // Edit the existing message to add the button
                await existing.edit({ components: [row] });
                openMessageId = messageId;
                await interaction.editReply({ content: `✅ Apply button added to the existing message in ${targetChannel}!` });
            } else {
                // Post a new standalone button message
                const msg = await targetChannel.send({
                    content: `> 📝 **${form.name}** — click below to apply${form.description ? `\n> ${form.description}` : ''}\n> Make sure your DMs are open!`,
                    components: [row]
                });
                openMessageId = msg.id;
                await interaction.editReply({ content: `✅ Apply button posted in ${targetChannel}!` });
            }

            await AppForm.findByIdAndUpdate(form._id, {
                open: true,
                openMessageId,
                openChannelId: targetChannel.id
            });
        }

        // ── CLOSE ──
        if (sub === 'close') {
            await interaction.deferReply({ ephemeral: true });
            const formSearch = interaction.options.getString('form_search').toLowerCase();
            const forms = await AppForm.find();
            const matched = forms.filter(f => f.name.toLowerCase().includes(formSearch));
            if (!matched.length) return interaction.editReply({ content: `❌ No form found matching **"${formSearch}"**.` });
            if (matched.length > 1) return interaction.editReply({ content: `⚠️ Multiple matches. Be more specific:\n${matched.map(f => `• **${f.name}**`).join('\n')}` });

            const form = matched[0];
            await AppForm.findByIdAndUpdate(form._id, { open: false });

            // Remove button from the original message if we can
            if (form.openMessageId && form.openChannelId) {
                try {
                    const ch = await client.channels.fetch(form.openChannelId);
                    const msg = await ch.messages.fetch(form.openMessageId);
                    if (msg.author.id === client.user.id) {
                        await msg.edit({ components: [] });
                    }
                } catch {}
            }

            return interaction.editReply({ content: `✅ **${form.name}** is now closed. The Apply button has been removed.` });
        }

        // ── DELETE ──
        if (sub === 'delete') {
            const formId = interaction.options.getString('form_id');
            const form = await AppForm.findByIdAndDelete(formId).catch(() => null);
            if (!form) return interaction.reply({ content: '❌ Form not found.', ephemeral: true });
            return interaction.reply({ content: `✅ Application form **${form.name}** deleted.`, ephemeral: true });
        }
    }
};