const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const REQUEST_CHANNEL_ID = '1462503910559453421';
const PING_ROLE_ID = '1434623628078743584';
const PROMOTIONAL_ROLE_ID = '1434623628078743584';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sesrequest')
    .setDescription('Submit a session request')
    .addStringOption(option =>
      option.setName('shift_type')
        .setDescription('Type of shift')
        .setRequired(true)
        .addChoices(
          { name: 'Regular Shift', value: 'Regular Shift' },
          { name: 'Training', value: 'Training' },
          { name: 'Promotional Shift', value: 'Promotional Shift' }
        ))
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Select a time slot')
        .setRequired(true)
        .addChoices(
          { name: '12:00 EST | 6:00 CET | 9:00 PT', value: '12:00 EST | 6:00 CET | 9:00 PT' },
          { name: '4:00 EST | 10:00 CET | 1:00 PT', value: '4:00 EST | 10:00 CET | 1:00 PT' },
          { name: '8:00 EST | 2:00 CET | 5:00 PT', value: '8:00 EST | 2:00 CET | 5:00 PT' }
        ))
    .addUserOption(option =>
      option.setName('cohost')
        .setDescription('Co-host (leave empty if none)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      // Check if promotional shift is being requested by someone without the role
      const shiftType = interaction.options.getString('shift_type');
      if (shiftType === 'Promotional Shift') {
        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(PROMOTIONAL_ROLE_ID)) {
          return interaction.editReply({ content: '❌ You do not have permission to request a Promotional Shift.' });
        }
      }

      const time = interaction.options.getString('time');
      const cohost = interaction.options.getUser('cohost');
      const cohostText = cohost ? `${cohost}` : 'No co-host — DM me to co-host!';

      const embed = new EmbedBuilder()
        .setTitle('📋 Session Request')
        .setColor(0x3498DB)
        .addFields(
          { name: '👤 Host', value: `${interaction.user}` },
          { name: '🎯 Shift Type', value: shiftType },
          { name: '🕒 Time', value: time },
          { name: '🤝 Co-Host', value: cohostText }
        )
        .setFooter({ text: 'Kavià Café • Session Requests' })
        .setTimestamp();

      const requestChannel = await interaction.client.channels.fetch(REQUEST_CHANNEL_ID);
      if (requestChannel?.isTextBased()) {
        await requestChannel.send({
          content: `<@&${PING_ROLE_ID}>`,
          embeds: [embed]
        });
      }

      await interaction.editReply({ content: '✅ Your session request has been submitted!' });

    } catch (err) {
      console.error('Error in /sesrequest command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};