const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1484973859513045224';

const DEPARTMENTS = [
  { name: 'SHR', value: 'SHR' },
  { name: 'PR Member', value: 'PR Member' },
  { name: 'MR Member', value: 'MR Member' },
  { name: 'HR Member', value: 'HR Member' },
  { name: 'Media Team', value: 'Media Team' },
  { name: 'Development Member', value: 'Development Member' },
  { name: 'Development Tester', value: 'Development Tester' },
  { name: 'Human Resources', value: 'Human Resources' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to blacklist')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for blacklist')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('your_rank')
        .setDescription('Your rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('department')
        .setDescription('Your department')
        .setRequired(true)
        .addChoices(...DEPARTMENTS))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
      const roleExists = interaction.guild.roles.cache.has(REQUIRED_ROLE_ID);
      if (roleExists && !member.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const yourRank = interaction.options.getString('your_rank');
      const department = interaction.options.getString('department');
      const proof = interaction.options.getString('proof') || 'Not provided';

      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, strikes: [], terminations: [], blacklists: [] });
      }

      record.blacklists.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        removed: false
      });

      await record.save();

      const dmMessage = `# <:kaviacafe:1387492814916685845> **Blacklist Notice**
Hello, ${user},
We regret to inform you that due to your recent actions and behavior, you have been **blacklisted** from **Kavià Café**. Your conduct has not aligned with the standards and expectations we uphold within our community, and as a result, this decision has been made.
After careful consideration, the **SHR Team** has determined that you are no longer permitted in any of our affiliated servers. Additionally, you are **not welcome to return as staff at any point in the future**. This decision is final and reflects the seriousness of the situation.
> <:pink_pin:1166850035611353148> **Status →** *Blacklisted*
> <:pink_pin:1166850035611353148> **Reason →** *${reason}*
If you wish to appeal this decision, you may do so using the link below:
[Appeals](https://discord.gg/tXxeJUxd9D)
Please refrain from attempting to rejoin or reapply, as this will not be accepted. Failure to comply may result in further action.
***Signed,***
**${interaction.user.username}**
**${yourRank} || ${department}**`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⛔ Staff Blacklisted')
        .setDescription('A staff member has been blacklisted.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Blacklisted Member', value: user.username },
          { name: '🏢 Department', value: department },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been blacklisted.` });

    } catch (err) {
      console.error('Error in /blacklist command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};