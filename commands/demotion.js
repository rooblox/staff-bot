const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
    .setName('demotion')
    .setDescription('Demote a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to demote')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('old_rank')
        .setDescription('Old rank of the user')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('new_rank')
        .setDescription('New rank of the user')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for demotion')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('appealable')
        .setDescription('Is this demotion appealable?')
        .setRequired(true)
        .addChoices(
          { name: 'Yes', value: 'Yes' },
          { name: 'No', value: 'No' }
        ))
    .addStringOption(option =>
      option.setName('department')
        .setDescription('Your department')
        .setRequired(true)
        .addChoices(...DEPARTMENTS)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
    }

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const oldRank = interaction.options.getString('old_rank');
      const newRank = interaction.options.getString('new_rank');
      const reason = interaction.options.getString('reason');
      const appealable = interaction.options.getString('appealable');
      const department = interaction.options.getString('department');

      const today = new Date();
      const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;

      const dmMessage = `# <:kaviacafe:1387492814916685845> | Demotion Notice
-# ${date}
Hello ${user},
Following review, you have been **demoted** effective immediately. This decision was reached after careful consideration and is intended to address your actions at Kavià. We ask that you reflect on the circumstances that led to this action and cooperate with any actions we need you to take.
Please allow time for staff to complete the rank change. Do **not** leave any servers you are currently a member of while the change is in progress.
> **Reason →** *${reason}*
> **Appealable →** *${appealable}*
If this demotion is appealable, and you wish to appeal it please open a ticket in the appeals server. A staff member will review your appeal and respond in a timely manner.
<:reply:1467007523981627392> This action was discussed and approved by members of the SHR+ team and was not taken on a personal bias.
***Sincerely,***
**${interaction.user.username} || ${department}**`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('📉 Staff Demoted')
        .setDescription('A staff member has been demoted.')
        .setColor(0xE67E22)
        .addFields(
          { name: '👮 Demoted By', value: interaction.user.username },
          { name: '⚡ Demoted Member', value: user.username },
          { name: '⬅️ Old Rank', value: oldRank },
          { name: '➡️ New Rank', value: newRank },
          { name: '🏢 Department', value: department },
          { name: '📝 Reason', value: reason },
          { name: '⚖️ Appealable', value: appealable }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been demoted.` });

    } catch (err) {
      console.error('Error in /demotion command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};