const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Session } = require('../db');

const REQUEST_CHANNEL_ID = '1493737208597971045';
const ANNOUNCEMENT_CHANNEL_ID = '1385105286926172160';
const ANNOUNCEMENT_GUILD_ID = '1370892833182974035';
const PING_ROLE_ID = '1439608585381478471';
const PROMOTIONAL_ROLE_ID = '1434623628078743584';
const REQUIRED_ROLE_ID = '1439608585381478471';
const REQUIRED_GUILD_ID = '1434556801096876034';
const SHIFT_PING_ROLE_ID = '1371568661592019044';
const TRAINING_PING_ROLE_ID = '1371568736569659462';
const MAIN_GUILD_ID = '1370892833182974035';

const SHIFT_TIMES = [
  { name: '12:00 AM EST | 6:00 AM CET | 9:00 PM PT', value: '12:00 AM EST | 6:00 AM CET | 9:00 PM PT' },
  { name: '2:00 AM EST | 8:00 AM CET | 11:00 PM PT', value: '2:00 AM EST | 8:00 AM CET | 11:00 PM PT' },
  { name: '4:00 AM EST | 10:00 AM CET | 1:00 AM PT', value: '4:00 AM EST | 10:00 AM CET | 1:00 AM PT' },
  { name: '6:00 AM EST | 12:00 PM CET | 3:00 AM PT', value: '6:00 AM EST | 12:00 PM CET | 3:00 AM PT' },
  { name: '8:00 AM EST | 2:00 PM CET | 5:00 AM PT', value: '8:00 AM EST | 2:00 PM CET | 5:00 AM PT' },
  { name: '10:00 AM EST | 4:00 PM CET | 7:00 AM PT', value: '10:00 AM EST | 4:00 PM CET | 7:00 AM PT' },
  { name: '12:00 PM EST | 6:00 PM CET | 9:00 AM PT', value: '12:00 PM EST | 6:00 PM CET | 9:00 AM PT' },
  { name: '2:00 PM EST | 8:00 PM CET | 11:00 AM PT', value: '2:00 PM EST | 8:00 PM CET | 11:00 AM PT' },
  { name: '4:00 PM EST | 10:00 PM CET | 1:00 PM PT', value: '4:00 PM EST | 10:00 PM CET | 1:00 PM PT' },
  { name: '6:00 PM EST | 12:00 AM CET | 3:00 PM PT', value: '6:00 PM EST | 12:00 AM CET | 3:00 PM PT' },
  { name: '8:00 PM EST | 2:00 AM CET | 5:00 PM PT', value: '8:00 PM EST | 2:00 AM CET | 5:00 PM PT' },
  { name: '10:00 PM EST | 4:00 AM CET | 7:00 PM PT', value: '10:00 PM EST | 4:00 AM CET | 7:00 PM PT' },
];

function parseSessionTime(timeStr) {
  const estPart = timeStr.split('|')[0].trim();
  const cleanTime = estPart.replace('EST', '').trim();

  const [time, period] = cleanTime.split(' ');
  let [hours, minutes] = time.split(':').map(Number);

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  const now = new Date();

  const sessionUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours + 4,
    minutes,
    0,
    0
  ));

  if (sessionUTC <= now) {
    sessionUTC.setUTCDate(sessionUTC.getUTCDate() + 1);
  }

  return sessionUTC;
}

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
          { name: 'Promotional Shift', value: 'Promotional Shift' }
        ))
    .addStringOption(option =>
      option.setName('shift_time')
        .setDescription('Select your shift time')
        .setRequired(true)
        .addChoices(...SHIFT_TIMES))
    .addUserOption(option =>
      option.setName('cohost')
        .setDescription('Co-host (leave empty if none)')
        .setRequired(false)),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      // Only allow this command in the required server
      if (interaction.guildId !== REQUIRED_GUILD_ID) {
        return interaction.editReply({ content: '❌ This command can only be used in the correct server.' });
      }

      // Check required role
      const requiredGuild = await client.guilds.fetch(REQUIRED_GUILD_ID);
      const requiredMember = await requiredGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!requiredMember || !requiredMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to submit a session request.' });
      }

      const shiftType = interaction.options.getString('shift_type');

      // Extra check for Promotional Shift
      if (shiftType === 'Promotional Shift') {
        const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
        const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
        if (!mainMember || !mainMember.roles.cache.has(PROMOTIONAL_ROLE_ID)) {
          return interaction.editReply({ content: '❌ You do not have permission to request a Promotional Shift.' });
        }
      }

      const time = interaction.options.getString('shift_time');
      const cohost = interaction.options.getUser('cohost');
      const cohostText = cohost ? `${cohost}` : 'No co-host — DM me to co-host!';
      const cohostId = cohost ? cohost.id : null;

      // Check for time conflict
      const conflict = await Session.findOne({
        time,
        status: { $in: ['pending', 'approved', 'active'] }
      });

      if (conflict) {
        try {
          await interaction.user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('❌ Session Time Unavailable')
                .setDescription(`Hello, <@${interaction.user.id}>,\n\nUnfortunately your session request for **${time}** has been automatically declined as that time slot is **already taken** by another host.\n\nPlease submit a new request with a different time slot. If you have any questions, please reach out to a member of our team.\n\n***Sincerely,***\n**Kavià Café Staff Team**`)
                .setColor(0xE74C3C)
                .setTimestamp()
            ]
          });
        } catch {}
        return interaction.editReply({ content: `❌ That time slot is already taken! Please choose a different time.` });
      }

      const sessionFireAt = parseSessionTime(time);

      const session = new Session({
        hostId: interaction.user.id,
        coHostId: cohostId,
        shiftType,
        time,
        requestChannelId: REQUEST_CHANNEL_ID,
        status: 'pending',
        preSessionReminderSent: false,
        sessionStarted: false,
        finishCheckStarted: false,
        hostConfirmed: false,
        createdAt: new Date(),
        sessionFireAt,
        autoDeleteAt: null
      });

      await session.save();

      const embed = new EmbedBuilder()
        .setTitle('📋 Session Request')
        .setColor(0x3498DB)
        .addFields(
          { name: '👤 Host', value: `${interaction.user} (${interaction.user.id})` },
          { name: '🎯 Shift Type', value: shiftType },
          { name: '🕒 Time', value: time },
          { name: '🤝 Co-Host', value: cohostText }
        )
        .setFooter({ text: `Session ID: ${session._id} • Kavià Café` })
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`sesaccept_${session._id}`)
            .setLabel('✅ Accept Request')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`sesdecline_${session._id}`)
            .setLabel('❌ Decline Request')
            .setStyle(ButtonStyle.Danger)
        );

      const requestChannel = await client.channels.fetch(REQUEST_CHANNEL_ID);
      if (requestChannel?.isTextBased()) {
        const msg = await requestChannel.send({
          content: `<@&${PING_ROLE_ID}>`,
          embeds: [embed],
          components: [row]
        });
        await Session.findByIdAndUpdate(session._id, { requestMessageId: msg.id });
      }

      await interaction.editReply({ content: '✅ Your session request has been submitted!' });

    } catch (err) {
      console.error('Error in /sesrequest command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  },

  parseSessionTime,
  REQUEST_CHANNEL_ID,
  ANNOUNCEMENT_CHANNEL_ID,
  ANNOUNCEMENT_GUILD_ID,
  SHIFT_PING_ROLE_ID,
  TRAINING_PING_ROLE_ID
};