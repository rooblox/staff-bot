const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Issue a strike to a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member to strike').setRequired(true))
        .addStringOption(option =>
            option.setName('rank').setDescription('User rank').setRequired(true))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for strike').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES))
        .addStringOption(option =>
            option.setName('proof').setDescription('Proof (optional)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
            if (!hasPerms) {
                return interaction.editReply({ content: `❌ You do not have permission to use this command for the **${department}** department. Make sure you are in the correct server and have the required role.` });
            }

            const user = interaction.options.getUser('user');
            const rank = interaction.options.getString('rank');
            const reason = interaction.options.getString('reason');
            const proof = interaction.options.getString('proof') || 'Not provided';

            let record = await StaffRecord.findById(user.id);
            if (!record) {
                record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
            }

            record.rank = rank;
            record.strikes.push({
                reason,
                date: new Date().toISOString(),
                addedBy: { id: interaction.user.id, username: interaction.user.username },
                department,
                removed: false
            });

            await record.save();

            const activeStrikes = record.strikes.filter(s => !s.removed && s.department === department).length;
            const allActiveStrikes = record.strikes.filter(s => !s.removed).length;
            const strikeLabel = allActiveStrikes === 1 ? '1st' : allActiveStrikes === 2 ? '2nd' : `${allActiveStrikes}th`;

            const dmMessage = `**Strike Notice**
> Greetings, ${user}
I'm unfortunately saddened to inform you that you have received a strike for your actions at Kavià Cafe.
This is your **${strikeLabel} strike.**
> 🗒️ **Reason:** *${reason}*
If you feel like this was false or inaccurate please *open a ticket*.
**Regards,**
**${interaction.user.username}**
**${rank}**
**Kavià || ${department}**`;

            try { await user.send({ content: dmMessage }); } catch {}

            const embed = new EmbedBuilder()
                .setTitle('🛑 Staff Strike Issued')
                .setDescription('A strike has been issued to a staff member.')
                .setColor(0xE74C3C)
                .addFields(
                    { name: '👮 Staff User', value: interaction.user.username },
                    { name: '⚡ Staff Member Striked', value: user.username },
                    { name: '🏷️ Rank', value: rank },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason', value: reason },
                    { name: '📊 Active Strikes (This Dept)', value: String(activeStrikes) },
                    { name: '📊 Total Active Strikes', value: String(allActiveStrikes) },
                    { name: '📎 Proof', value: proof }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ ${user.tag} has been issued a strike.` });

        } catch (err) {
            console.error('Error in /strike command:', err);
            try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
        }
    }
};