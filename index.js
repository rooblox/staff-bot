require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { connectDB, Reminder } = require('./db');

const REQUEST_CHANNEL_ID = '1462503910559453421';
const REQUIRED_BUTTON_ROLE_ID = '1434623628078743584';
const TRAINING_LINK = 'https://docs.google.com/document/d/1BW5Nmy14butcEscy9PMOTeAbfsfAwj9pJF2uXNkQu6A/edit?usp=drivesdk';
const SHIFT_LINK = 'https://docs.google.com/document/d/12MhP5KnwSqvpiP7w6l7iqgFuJwWkoMNpKYQCdtp3vfA/edit?usp=drivesdk';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: ['CHANNEL']
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
const cmds = [];
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (!command.data || !command.execute) continue;
    client.commands.set(command.data.name, command);
    cmds.push(command.data.toJSON());
    console.log(`Loaded command: ${command.data.name}`);
}

client.on('interactionCreate', async interaction => {

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`❌ Command error [/${interaction.commandName}]`, error);
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: `❌ Error running command.`, ephemeral: true });
                } catch (err) {
                    console.error('Failed to send error reply:', err);
                }
            }
        }
        return;
    }

    // Handle buttons
    if (interaction.isButton()) {
        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(REQUIRED_BUTTON_ROLE_ID)) {
            return interaction.reply({ content: '❌ You do not have permission to use this button.', ephemeral: true });
        }

        const [action, userId, ...shiftParts] = interaction.customId.split('_');
        const shiftType = shiftParts.join('_');

        if (action === 'sesaccept') {
            try {
                const user = await client.users.fetch(userId);

                let linkText = '';
                if (shiftType === 'Training') {
                    linkText = `\n\nPlease review the training guide before your session:\n${TRAINING_LINK}`;
                } else if (shiftType === 'Regular Shift') {
                    linkText = `\n\nPlease review the shift guide before your session:\n${SHIFT_LINK}`;
                }

                const dmMessage = `# <:kaviacafe:1387492814916685845> **Session Request Accepted**
Hello, ${user},
We are delighted to inform you that your **${shiftType}** request has been **accepted** at **Kavià Café**! We are looking forward to having you host this session and appreciate your dedication to our community.
Your request has been reviewed and approved by a member of our team. Please ensure you are prepared and ready for your session at the scheduled time.
> <:pink_pin:1166850035611353148> **Shift Type →** *${shiftType}*
> <:pink_pin:1166850035611353148> **Status →** *Accepted ✅*
Should you have any questions or concerns prior to your session, please do not hesitate to reach out to a member of our team. We wish you the best of luck and hope you have a wonderful session!${linkText}
***Signed,***
**${interaction.user.username}**
**Kavià Café Staff Team**`;

                await user.send({ content: dmMessage });

                // Update the embed to show accepted
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor(0x2ECC71)
                    .setTitle('📋 Session Request — ✅ Accepted')
                    .setFooter({ text: `Accepted by ${interaction.user.username}` });

                await interaction.update({ embeds: [newEmbed], components: [] });

            } catch (err) {
                console.error('Error accepting session request:', err);
                await interaction.reply({ content: '❌ Error accepting request.', ephemeral: true });
            }

        } else if (action === 'sesdecline') {
            // Show a modal to get decline reason
            const modal = new ModalBuilder()
                .setCustomId(`sesdeclinemodal_${userId}_${shiftType}`)
                .setTitle('Decline Session Request');

            const reasonInput = new TextInputBuilder()
                .setCustomId('declinereason')
                .setLabel('Reason for declining')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Enter the reason for declining this request...')
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
        }
        return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('sesdeclinemodal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});

            try {
                const parts = interaction.customId.split('_');
                const userId = parts[1];
                const shiftType = parts.slice(2).join('_');
                const reason = interaction.fields.getTextInputValue('declinereason');

                const user = await client.users.fetch(userId);

                const dmMessage = `# <:kaviacafe:1387492814916685845> **Session Request Declined**
Hello, ${user},
We regret to inform you that your **${shiftType}** request has been **declined** at **Kavià Café**. We understand this may be disappointing, and we appreciate your enthusiasm for hosting sessions within our community.
After careful review, your request was unable to be approved at this time. Please take note of the reason provided below and feel free to submit a new request in the future.
> <:pink_pin:1166850035611353148> **Shift Type →** *${shiftType}*
> <:pink_pin:1166850035611353148> **Status →** *Declined ❌*
> <:pink_pin:1166850035611353148> **Reason →** *${reason}*
We encourage you to review the reason provided and reach out to a member of our team if you have any questions or concerns. We hope to see you submit another request soon!
***Signed,***
**${interaction.user.username}**
**Kavià Café Staff Team**`;

                await user.send({ content: dmMessage });

                // Update the embed to show declined
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor(0xE74C3C)
                    .setTitle('📋 Session Request — ❌ Declined')
                    .setFooter({ text: `Declined by ${interaction.user.username} — Reason: ${reason}` });

                await interaction.message.edit({ embeds: [newEmbed], components: [] });
                await interaction.editReply({ content: '✅ Request declined and user notified.' });

            } catch (err) {
                console.error('Error declining session request:', err);
                try { await interaction.editReply({ content: '❌ Error declining request.' }); } catch {}
            }
        }
        return;
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;

    const logChannelId = '1462580398935642144';
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

    try { await message.react('✅'); } catch (err) {
        console.error('Failed to react to user DM:', err);
    }

    const userReplyEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('💬 **DM Received**')
        .addFields(
            { name: '📤 From (User)', value: `${message.author.tag} (${message.author.id})` },
            { name: '📥 To (Bot)', value: `${client.user.tag}` },
            { name: '📝 Message', value: message.content },
            { name: '🕒 Date & Time', value: timestamp }
        )
        .setFooter({ text: 'Kavia Cafe • DM Logs' });

    try {
        const logChannel = await client.channels.fetch(logChannelId);
        if (logChannel) await logChannel.send({ embeds: [userReplyEmbed] });
    } catch (err) {
        console.error('Error logging user DM:', err);
    }
});

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    console.log('✅ Cleared global commands');

    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: [] }
            );
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: cmds }
            );
            console.log(`✅ Commands registered in guild: ${guild.name}`);
        } catch (err) {
            console.error(`❌ Failed to register commands in guild ${guild.name}:`, err);
        }
    }

    const { scheduleReminder } = require('./commands/remind');
    const pendingReminders = await Reminder.find({ fireAt: { $gt: new Date() } });
    for (const reminder of pendingReminders) {
        scheduleReminder(reminder, client);
    }
    console.log(`✅ Reloaded ${pendingReminders.length} pending reminders`);
});

client.on('guildCreate', async guild => {
    console.log(`✅ Joined new guild: ${guild.name}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: cmds }
        );
        console.log(`✅ Commands registered in new guild: ${guild.name}`);
    } catch (err) {
        console.error(`❌ Failed to register commands in new guild ${guild.name}:`, err);
    }
});

connectDB().then(() => {
    client.login(process.env.TOKEN);
    console.log('✅ Bot started successfully!');
}).catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
});