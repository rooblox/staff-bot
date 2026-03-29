const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const ALLIANCE_GUILD_ID = '1385081586285940796';
const ALLIED_REP_ROLE_ID = '1371492999854293024';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alliancecheck')
    .setDescription('Check and sync allied rep roles with the alliance server'),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
      const allianceGuild = await client.guilds.fetch(ALLIANCE_GUILD_ID);

      // Fetch all members from both servers
      await mainGuild.members.fetch();
      await allianceGuild.members.fetch();

      const mainMembers = mainGuild.members.cache;
      const allianceMembers = allianceGuild.members.cache;

      const rolesAdded = [];
      const rolesRemoved = [];
      const notified = [];

      // Check 1: Members in alliance server but missing allied rep role in main server
      for (const [id, allianceMember] of allianceMembers) {
        const mainMember = mainMembers.get(id);
        if (mainMember && !mainMember.roles.cache.has(ALLIED_REP_ROLE_ID)) {
          try {
            await mainMember.roles.add(ALLIED_REP_ROLE_ID);
            rolesAdded.push(`<@${id}> (${allianceMember.user.tag})`);
          } catch (err) {
            console.error(`Failed to add role to ${allianceMember.user.tag}:`, err);
          }
        }

        // Member is in alliance server but NOT in main server
        if (!mainMember) {
          notified.push(`⚠️ **${allianceMember.user.tag}** is in the alliance server but **not in the main server**`);
        }
      }

      // Check 2: Members with allied rep role in main server but not in alliance server
      for (const [id, mainMember] of mainMembers) {
        if (mainMember.roles.cache.has(ALLIED_REP_ROLE_ID)) {
          const allianceMember = allianceMembers.get(id);
          if (!allianceMember) {
            try {
              await mainMember.roles.remove(ALLIED_REP_ROLE_ID);
              rolesRemoved.push(`<@${id}> (${mainMember.user.tag})`);
            } catch (err) {
              console.error(`Failed to remove role from ${mainMember.user.tag}:`, err);
            }
          }
        }
      }

      // Build result embed
      const embed = new EmbedBuilder()
        .setTitle('🔍 Alliance Check Results')
        .setColor(0x3498DB)
        .setTimestamp()
        .setFooter({ text: 'Kavià Café • Alliance Check' });

      embed.addFields({
        name: `✅ Roles Added (${rolesAdded.length})`,
        value: rolesAdded.length > 0 ? rolesAdded.join('\n') : 'None'
      });

      embed.addFields({
        name: `❌ Roles Removed (${rolesRemoved.length})`,
        value: rolesRemoved.length > 0 ? rolesRemoved.join('\n') : 'None'
      });

      if (notified.length > 0) {
        embed.addFields({
          name: `⚠️ Needs Attention (${notified.length})`,
          value: notified.join('\n')
        });
      }

      embed.addFields({
        name: '📊 Summary',
        value: `Checked **${mainMembers.size}** main server members and **${allianceMembers.size}** alliance server members.`
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error in /alliancecheck command:', err);
      try { await interaction.editReply({ content: '❌ Error running alliance check. Make sure the bot has the correct permissions in both servers.' }); } catch {}
    }
  }
};