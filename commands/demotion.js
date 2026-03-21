const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const oldRank = interaction.options.getString('old_rank');
      const newRank = interaction.options.getString('new_rank');
      const reason = interaction.options.getString('reason');

      const dmMessage = `# 📢 Demotion Notice

Greetings, ${user},

We regret to inform you that you have been **demoted** at **Kavià Café**.

> **Old rank →** ${oldRank}
> **New rank →** ${newRank}
> **Reason →** ${reason}

If you have any questions, please open a support ticket in the server.

*Signed,*
**${interaction.user.username}**
|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('📉 Staff Demotion')
        .setDescription('A staff member has been demoted.')
        .setColor(0xE67E22)
        .addFields(
          { name: '👮 Demoted By', value: interaction.user.username },
          { name: '⚡ Demoted Member', value: user.username },
          { name: '⬅️ Old Rank', value: oldRank },
          { name: '➡️ New Rank', value: newRank },
          { name: '📝 Reason', value: reason }
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
