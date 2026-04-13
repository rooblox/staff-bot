const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

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
    .setName('promotion')
    .setDescription('Promote a staff member')
    .addUserOption(option =>
      option.setName('user').setDescription('Staff member to promote').setRequired(true))
    .addStringOption(option =>
      option.setName('old_rank').setDescription('Old rank of the user').setRequired(true))
    .addStringOption(option =>
      option.setName('new_rank').setDescription('New rank of the user').setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for promotion').setRequired(true))
    .addStringOption(option =>
      option.setName('your_rank').setDescription('Your rank').setRequired(true))
    .addStringOption(option =>
      option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPARTMENTS)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
      const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const oldRank = interaction.options.getString('old_rank');
      const newRank = interaction.options.getString('new_rank');
      const reason = interaction.options.getString('reason');
      const yourRank = interaction.options.getString('your_rank');
      const department = interaction.options.getString('department');

      const dmMessage = `# <:kaviacafe:1387492814916685845> **Promotion Notice**
Hello, ${user},
We are delighted to inform you that you have been **promoted** following your recent actions and performance at **Kavià Café**. Your continued hard work and dedication have not gone unnoticed. You have consistently demonstrated professionalism and commitment, and have set a strong example for other staff.
On behalf of the **${department}**, we would like to congratulate you. This promotion reflects the trust we have in your abilities and the value you bring to our community. We are confident that you will continue to perform in your new role and set a strong example for others.
> <:pink_pin:1166850035611353148> **Old Rank →** *${oldRank}*
> <:pink_pin:1166850035611353148> **New Rank →** *${newRank}*
You will be ranked in our main server and Roblox group shortly. Should you have any questions or concerns, do not hesitate to reach out to a member of our team.
We are ecstatic to see what the future holds for you at **Kavià Café**, and we look forward to watching you continue to grow with us.
***Signed,***
**${interaction.user.username}**
**${yourRank} || ${department}**`;

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
          { name: '🏢 Department', value: department },
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