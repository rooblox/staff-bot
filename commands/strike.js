const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

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
    .setName('strike')
    .setDescription('Issue a strike to a staff member')
    .addUserOption(option =>
      option.setName('user').setDescription('Staff member to strike').setRequired(true))
    .addStringOption(option =>
      option.setName('rank').setDescription('User rank').setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for strike').setRequired(true))
    .addStringOption(option =>
      option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPARTMENTS))
    .addStringOption(option =>
      option.setName('proof').setDescription('Proof (optional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
      const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const department = interaction.options.getString('department');
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
        removed: false
      });

      await record.save();

      const activeStrikes = record.strikes.filter(s => !s.removed).length;
      const strikeLabel = activeStrikes === 1 ? '1st' : activeStrikes === 2 ? '2nd' : `${activeStrikes}th`;

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
          { name: '📊 Current Strikes', value: String(activeStrikes) },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been issued a strike.` });

    } catch (err) {
      console.error('Error in /strike command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};