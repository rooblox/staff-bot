const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');
const { DEPT_CHOICES, checkDeptPermission, getDeptLogChannel } = require('./departments');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removediscipline')
        .setDescription('Remove a strike, termination, or blacklist entry from a staff member')
        .addUserOption(option =>
            option.setName('user').setDescription('Staff member').setRequired(true))
        .addStringOption(option =>
            option.setName('type').setDescription('Type of discipline to remove').setRequired(true)
                .addChoices(
                    { name: 'Strike', value: 'strike' },
                    { name: 'Termination', value: 'termination' },
                    { name: 'Blacklist', value: 'blacklist' }
                ))
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for removal').setRequired(true))
        .addStringOption(option =>
            option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPT_CHOICES))
        .addIntegerOption(option =>
            option.setName('number').setDescription('Strike number (required if removing a strike)').setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        try {
            const department = interaction.options.getString('department');
            const hasPerms = await checkDeptPermission(client, interaction.user.id, department);
            if (!hasPerms) {
                return interaction.editReply({ content: `❌ You do not have permission to use this command for the **${department}** department.` });
            }

            const user = interaction.options.getUser('user');
            const type = interaction.options.getString('type');
            const number = interaction.options.getInteger('number');
            const reason = interaction.options.getString('reason');

            const record = await StaffRecord.findById(user.id);
            if (!record) return interaction.editReply({ content: '❌ This user has no discipline records.' });

            if (type === 'strike') {
                const deptStrikes = record.strikes.filter(s => !s.removed && s.department === department);
                if (!number || number < 1 || number > deptStrikes.length) {
                    return interaction.editReply({ content: `❌ Invalid strike number. This user has ${deptStrikes.length} active strike(s) in the **${department}** department.` });
                }
                const strike = deptStrikes[number - 1];
                const strikeLabel = number === 1 ? '1st' : number === 2 ? '2nd' : `${number}th`;
                strike.removed = true;
                strike.removedBy = interaction.user.id;
                strike.removedReason = reason;
                strike.removedAt = new Date().toISOString();

                const dmMessage = `# <:kaviacafe:1387492814916685845> | Strike Removal
Greetings, ${user}
I am delighted to inform you that your appeal regarding your *${strikeLabel} strike* has been **accepted**.
> **Reason for strike removal →** *${reason}*
**Signed,**
**${interaction.user.username} || ${department}**`;

                try { await user.send({ content: dmMessage }); } catch {}

            } else if (type === 'termination') {
                const deptTerms = record.terminations?.filter(t => !t.removed && t.department === department) || [];
                if (deptTerms.length === 0) {
                    return interaction.editReply({ content: `❌ No terminations found for this user in the **${department}** department.` });
                }
                const term = deptTerms[deptTerms.length - 1];
                term.removed = true;
                term.removedBy = interaction.user.id;
                term.removedReason = reason;
                term.removedAt = new Date().toISOString();

            } else if (type === 'blacklist') {
                const deptBls = record.blacklists?.filter(b => !b.removed && b.department === department) || [];
                if (deptBls.length === 0) {
                    return interaction.editReply({ content: `❌ No blacklists found for this user in the **${department}** department.` });
                }
                const bl = deptBls[deptBls.length - 1];
                bl.removed = true;
                bl.removedBy = interaction.user.id;
                bl.removedReason = reason;
                bl.removedAt = new Date().toISOString();
            }

            await record.save();

            const embed = new EmbedBuilder()
                .setTitle('✅ Discipline Removed')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '👮 Staff User', value: interaction.user.username },
                    { name: '⚡ Member', value: user.username },
                    { name: '🗂️ Type', value: type.charAt(0).toUpperCase() + type.slice(1) },
                    { name: '🏢 Department', value: department },
                    { name: '📝 Reason for Removal', value: reason }
                )
                .setFooter({ text: `${department} Department` })
                .setTimestamp();

            const logChannel = await getDeptLogChannel(client, department);
            if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

            await interaction.editReply({ content: `✅ Successfully removed ${type} record from ${user.tag}.` });

        } catch (err) {
            console.error('Error in /removediscipline command:', err);
            try { await interaction.editReply({ content: '❌ Error removing discipline.' }); } catch {}
        }
    }
};