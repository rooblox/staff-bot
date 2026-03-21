const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promotion')
    .setDescription('Promote a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to promote')
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
        .setDescription('Reason for promotion')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const oldRank = interaction.options.getString('old_rank');
      const newRank = interaction.options.getString('new_rank');
      const reason = interaction.options.getString('reason');

      const dmMessage = `# 🎉 Promotion notice

Greetings, ${user},

I am delighted to inform you that you have been **Promoted**, following your hard work and dedication at Kavià Café. We have taken notice of this a while ago and felt it was best to promote you.

> **Old rank->** ${oldRank}
> **New rank->** ${newRank}

I would also like to personally congratulate you, and we are excited to see what the future holds for you at Kavià Café. Please give me a moment to update your roles, and you can settle into your new role.

***Signed,***
**${interaction.user.username}|| Human Resources Department.**`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('🎉 Staff Promotion')
        .setDescription('A staff member has been promoted.')
        .setColor(0x2ECC71)
        .addFields(
          { name: '👮 Promoted By', value: interaction.user.username },
          { name: '⚡ Promoted Member', value: user.username },
          { name: '⬅️ Old Rank', value: oldRank },
          { name: '➡️ New Rank', value: newRank },
          { name: '📝 Reason', value: reason }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been promoted.` });

    } catch (err) {
      console.error('Error in /promotion command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};