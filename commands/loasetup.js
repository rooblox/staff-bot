const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { DEPARTMENTS, DEPT_CHOICES } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loasetup')
        .setDescription('Set up the LOA request panel in this server')
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel to post the LOA panel in').setRequired(true))
        .addChannelOption(opt =>
            opt.setName('logchannel').setDescription('Channel to log LOA requests to').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Check dept role permission for this server
            const deptConfig = Object.values(DEPARTMENTS).find(d => d.serverId === interaction.guildId);
            if (!deptConfig) {
                return interaction.editReply({ content: '❌ This server is not configured as a department server.' });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.roles.cache.has(deptConfig.roleId)) {
                return interaction.editReply({ content: '❌ You do not have permission to run this command.' });
            }

            const channel = interaction.options.getChannel('channel');
            const logChannel = interaction.options.getChannel('logchannel');

            const embed = new EmbedBuilder()
                .setTitle('📋 Leave of Absence Requests')
                .setColor(0x5865F2)
                .setDescription(
                    `**What is a Leave of Absence?**\n` +
                    `A Leave of Absence (LOA) is a temporary period where you are excused from your staff duties at Kavià Café.\n\n` +
                    `**When should I request one?**\n` +
                    `You should request an LOA if you will be inactive for **3 or more days** due to personal reasons such as:\n` +
                    `> 🏖️ Vacation or travel\n` +
                    `> 📚 School exams or assignments\n` +
                    `> 🏥 Medical reasons\n` +
                    `> 👨‍👩‍👧 Family matters\n\n` +
                    `**How long does approval take?**\n` +
                    `LOA requests are typically reviewed within **24–48 hours** by department leadership.\n\n` +
                    `**What happens after I submit?**\n` +
                    `You will receive a DM from the bot letting you know whether your request has been approved or denied. On your return date, the bot will remind you to confirm your return.\n\n` +
                    `> ⚠️ Submitting a false LOA or abusing this system may result in disciplinary action.\n\n` +
                    `Click the button below to submit your request!`
                )
                .setFooter({ text: 'Kavià Café • Leave of Absence System' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loa_request_${logChannel.id}`)
                    .setLabel('📋 Request Leave of Absence')
                    .setStyle(ButtonStyle.Primary)
            );

            await channel.send({ embeds: [embed], components: [row] });
            await interaction.editReply({ content: `✅ LOA panel posted in <#${channel.id}>! Requests will log to <#${logChannel.id}>.` });

        } catch (err) {
            console.error('Error in /loasetup:', err);
            try { await interaction.editReply({ content: `❌ Error: ${err.message}` }); } catch {}
        }
    }
};