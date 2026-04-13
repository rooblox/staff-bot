const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffinfo')
    .setDescription('View a full summary of a staff member')
    .addUserOption(option =>
      option.setName('user').setDescription('Staff member to view').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
      const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const user = interaction.options.getUser('user');
      const record = await StaffRecord.findById(user.id);

      let targetMember = null;
      try {
        targetMember = await mainGuild.members.fetch(user.id);
      } catch {}

      const activeStrikes = record?.strikes?.filter(s => !s.removed) || [];
      const pastStrikes = record?.strikes?.filter(s => s.removed) || [];
      const activeTerminations = record?.terminations?.filter(t => !t.removed) || [];
      const activeBlacklists = record?.blacklists?.filter(b => !b.removed) || [];
      const notes = record?.notes || [];

      const createdAt = `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`;
      const joinedAt = targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:D>` : 'Not in server';
      const roles = targetMember
        ? targetMember.roles.cache
            .filter(r => r.id !== targetMember.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.name)
            .slice(0, 10)
            .join(', ') || 'None'
        : 'Not in server';
      const nickname = targetMember?.nickname || 'None';

      const embed = new EmbedBuilder()
        .setTitle(`👤 Staff Info — ${user.tag}`)
        .setColor(0x3498DB)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '📋 Basic Info', value: `**User:** ${user}\n**Rank:** ${record?.rank || 'Not set'}\n**Nickname:** ${nickname}\n**Account Created:** ${createdAt}\n**Joined Server:** ${joinedAt}` },
          { name: '🎭 Roles', value: roles },
          { name: `⚠️ Active Strikes (${activeStrikes.length})`, value: activeStrikes.length > 0 ? activeStrikes.map((s, i) => `**#${i + 1}** — ${s.reason} — *${s.date.slice(0, 10)}*`).join('\n') : 'None' },
          { name: `✅ Past Strikes (${pastStrikes.length})`, value: pastStrikes.length > 0 ? pastStrikes.map((s, i) => `**#${i + 1}** — ${s.reason} — *${s.date.slice(0, 10)}*`).join('\n') : 'None' },
          { name: `⚡ Terminations (${activeTerminations.length})`, value: activeTerminations.length > 0 ? activeTerminations.map((t, i) => `**#${i + 1}** — ${t.reason} — *${t.date.slice(0, 10)}*`).join('\n') : 'None' },
          { name: `⛔ Blacklists (${activeBlacklists.length})`, value: activeBlacklists.length > 0 ? activeBlacklists.map((b, i) => `**#${i + 1}** — ${b.reason} — *${b.date.slice(0, 10)}*`).join('\n') : 'None' },
          { name: `📝 Notes (${notes.length})`, value: notes.length > 0 ? notes.map((n, i) => `**#${i + 1}** — ${n.note} — *${n.addedBy?.username || 'Unknown'}*`).join('\n') : 'None' }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error in /staffinfo command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};