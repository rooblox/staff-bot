require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { connectDB, Reminder } = require('./db');

const REQUEST_CHANNEL_ID = '1462503910559453421';
const REQUIRED_BUTTON_ROLE_ID = '1434623628078743584';
const TRAINING_BUTTON_ROLE_ID = '1464028127440273458';
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

// Load training module
const trainingModule = require('./commands/startmodtraining');
const {
    activeSessions,
    getSectionEmbed,
    getSectionButtons,
    getQuizEmbed,
    getQuizButtons,
    quizQuestions,
    sections,
    closingNotes,
    LOG_CHANNEL_ID
} = trainingModule;

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

        // ========== TRAINING BUTTONS ==========
        if (interaction.customId.startsWith('training_done_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);

            if (interaction.user.id !== userId) {
                return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            }

            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });
            if (session.locked) return interaction.reply({ content: '🔒 Your session is locked. Please wait for a staff member to resolve your help request.', ephemeral: true });

            const nextSection = sectionIndex + 1;

            // Disable the current buttons
            await interaction.update({ components: [] });

            if (nextSection < sections.length) {
                session.section = nextSection;
                const embed = getSectionEmbed(nextSection);
                const buttons = getSectionButtons(userId, nextSection);
                await interaction.user.send({ embeds: [embed], components: [buttons] });
            } else {
                // All sections done, start quiz
                session.phase = 'quiz';
                session.quizIndex = 0;
                session.score = 0;

                const introEmbed = new EmbedBuilder()
                    .setTitle('<:emoji_1:1464065515579248854>  Test Segment')
                    .setDescription(`You're about to start your test segment! Please take a moment to answer each question thoughtfully before submitting.\n\nRemember, each question is worth one point.\n\n**Good luck!**`)
                    .setColor(0x9B59B6)
                    .setTimestamp();

                await interaction.user.send({ embeds: [introEmbed] });

                setTimeout(async () => {
                    const quizEmbed = getQuizEmbed(0, 0);
                    const quizButtons = getQuizButtons(userId, 0);
                    await interaction.user.send({ embeds: [quizEmbed], components: [quizButtons] });
                }, 2000);
            }
            return;
        }

        if (interaction.customId.startsWith('training_help_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);

            if (interaction.user.id !== userId) {
                return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            }

            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });

            session.locked = true;
            await interaction.update({ components: [] });

            await interaction.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🆘 Help Request Sent')
                        .setDescription('Your help request has been sent to a staff member. Please wait — your session has been paused until the issue is resolved.')
                        .setColor(0xE74C3C)
                        .setTimestamp()
                ]
            });

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (logChannel?.isTextBased()) {
                const resolveRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`training_resolve_${userId}_${sectionIndex}`)
                        .setLabel('✅ Mark as Resolved')
                        .setStyle(ButtonStyle.Success)
                );

                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🆘 Training Help Request')
                            .setColor(0xE74C3C)
                            .addFields(
                                { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                                { name: '📖 Section', value: `Section ${sectionIndex + 1} — ${sections[sectionIndex].title}` }
                            )
                            .setTimestamp()
                    ],
                    components: [resolveRow]
                });
            }
            return;
        }

        if (interaction.customId.startsWith('training_resolve_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sectionIndex = parseInt(parts[3]);

            // Check staff role
            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(TRAINING_BUTTON_ROLE_ID)) {
                return interaction.reply({ content: '❌ You do not have permission to resolve training sessions.', ephemeral: true });
            }

            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active session found for this user.', ephemeral: true });

            session.locked = false;
            await interaction.update({ components: [] });

            const user = await client.users.fetch(userId);
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Help Request Resolved')
                        .setDescription('A staff member has resolved your help request. You may now continue your training by clicking **Done** below.')
                        .setColor(0x2ECC71)
                        .setTimestamp()
                ]
            });

            const embed = getSectionEmbed(sectionIndex);
            const buttons = getSectionButtons(userId, sectionIndex);
            await user.send({ embeds: [embed], components: [buttons] });
            return;
        }

        // ========== QUIZ BUTTONS ==========
        if (interaction.customId.startsWith('quiz_')) {
            const parts = interaction.customId.split('_');
            const answer = parts[1];
            const userId = parts[2];
            const questionIndex = parseInt(parts[3]);

            if (interaction.user.id !== userId) {
                return interaction.reply({ content: '❌ This is not your training session.', ephemeral: true });
            }

            const session = activeSessions.get(userId);
            if (!session) return interaction.reply({ content: '❌ No active training session found.', ephemeral: true });

            const q = quizQuestions[questionIndex];
            const correct = answer === q.answer;
            if (correct) session.score++;

            await interaction.update({ components: [] });

            await interaction.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setDescription(correct ? '✅ Correct!' : `❌ Incorrect. The correct answer was **${q.answer}) ${q.options[q.answer]}**`)
                        .setColor(correct ? 0x2ECC71 : 0xE74C3C)
                ]
            });

            const nextQuestion = questionIndex + 1;

            if (nextQuestion < quizQuestions.length) {
                setTimeout(async () => {
                    const quizEmbed = getQuizEmbed(nextQuestion, session.score);
                    const quizButtons = getQuizButtons(userId, nextQuestion);
                    await interaction.user.send({ embeds: [quizEmbed], components: [quizButtons] });
                }, 1500);
            } else {
                // Quiz complete — send closing notes then results to log
                await interaction.user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('<:emoji_1:1464065515579248854>  Closing Notes')
                            .setDescription(closingNotes)
                            .setColor(0x3498DB)
                            .setTimestamp()
                    ]
                });

                const passed = session.score >= 6;
                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

                if (logChannel?.isTextBased()) {
                    const resultRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`training_pass_${userId}`)
                            .setLabel('✅ Pass')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`training_fail_${userId}`)
                            .setLabel('❌ Fail')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('📝 Training Quiz Results')
                                .setColor(0x9B59B6)
                                .addFields(
                                    { name: '👤 Trainee', value: `<@${userId}> (${userId})` },
                                    { name: '📊 Score', value: `${session.score}/${quizQuestions.length}` },
                                    { name: '🎯 Suggested Result', value: passed ? '✅ Pass (6 or more correct)' : '❌ Fail (less than 6 correct)' }
                                )
                                .setTimestamp()
                        ],
                        components: [resultRow]
                    });
                }
            }
            return;
        }

        // ========== PASS/FAIL BUTTONS ==========
        if (interaction.customId.startsWith('training_pass_')) {
            const userId = interaction.customId.split('_')[2];

            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(TRAINING_BUTTON_ROLE_ID)) {
                return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            }

            const user = await client.users.fetch(userId);
            activeSessions.delete(userId);
            await interaction.update({ components: [] });

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('<:emoji_1:1464065515579248854>  Congratulations!')
                        .setDescription(`Congratulations, ${user}! 🎉\n\nYou have successfully **passed** your Moderation Trial at **Kavià Café**! Your hard work and dedication throughout this training have not gone unnoticed, and we are thrilled to welcome you as a full member of the Moderation Department.\n\nYour permissions will be granted shortly. We look forward to seeing you grow within the team and are excited for what the future holds for you here at Kavià Café!\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
                        .setColor(0x2ECC71)
                        .setTimestamp()
                ]
            });
            return;
        }

        if (interaction.customId.startsWith('training_fail_')) {
            const userId = interaction.customId.split('_')[2];

            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(TRAINING_BUTTON_ROLE_ID)) {
                return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
            }

            const user = await client.users.fetch(userId);
            await interaction.update({ components: [] });

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('<:emoji_1:1464065515579248854>  Training Result')
                        .setDescription(`Hello, ${user}.\n\nUnfortunately, you have **not passed** your Moderation Trial at this time. Please don't be discouraged — this is a learning experience, and we believe in your ability to improve.\n\nYour training will now restart from the beginning. Please take your time to carefully review each section before proceeding.\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
                        .setColor(0xE74C3C)
                        .setTimestamp()
                ]
            });

            // Restart training
            activeSessions.set(userId, {
                staffId: session?.staffId || interaction.user.id,
                guildId: interaction.guild.id,
                section: 0,
                quizIndex: 0,
                score: 0,
                phase: 'sections',
                locked: false,
                client
            });

            setTimeout(async () => {
                const embed = getSectionEmbed(0);
                const buttons = getSectionButtons(userId, 0);
                await user.send({ embeds: [embed], components: [buttons] });
            }, 2000);
            return;
        }

        // ========== SESSION REQUEST BUTTONS ==========
        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        if (interaction.customId.startsWith('sesaccept_') || interaction.customId.startsWith('sesdecline_')) {
            if (!member.roles.cache.has(REQUIRED_BUTTON_ROLE_ID)) {
                return interaction.reply({ content: '❌ You do not have permission to use this button.', ephemeral: true });
            }
        }

        if (interaction.customId.startsWith('sesaccept_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[1];
            const shiftType = parts.slice(2).join('_');

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
            return;
        }

        if (interaction.customId.startsWith('sesdecline_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[1];
            const shiftType = parts.slice(2).join('_');

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
            return;
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

    // React with 👀 to DMs during active training
    if (message.channel.type === 1) {
        if (activeSessions.has(message.author.id)) {
            try { await message.react('👀'); } catch {}
        }

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