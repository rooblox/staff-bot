const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const BOT_PERMS_ROLE = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

function isLikelyAlt(member) {
    const now = Date.now();
    const accountAge = now - member.user.createdTimestamp;
    const joinAge = now - member.joinedTimestamp;
    const days30 = 30 * 24 * 60 * 60 * 1000;
    const days90 = 90 * 24 * 60 * 60 * 1000;
    const days7 = 7 * 24 * 60 * 60 * 1000;

    const reasons = [];

    if (accountAge < days30) reasons.push('Account created less than 30 days ago');
    if (accountAge < days90 && member.user.avatar === null) reasons.push('Account under 90 days old with default avatar');
    if (joinAge < days7) reasons.push('Joined server less than 7 days ago');
    if (member.roles.cache.size <= 1) reasons.push('No roles (only @everyone)');
    if (/\d{4,}$/.test(member.user.username)) reasons.push('Username ends in 4+ numbers');
    if (member.user.username.length <= 4) reasons.push('Very short username (4 chars or less)');

    return reasons;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('auditalts')
        .setDescription('Scan the server for likely alt accounts')
        .addIntegerOption(opt =>
            opt.setName('page').setDescription('Page number').setMinValue(1).setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.roles.cache.has(BOT_PERMS_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        if (interaction.guild.id !== MAIN_GUILD_ID) {
            return interaction.reply({ content: '❌ This command can only be used in the main Kavià Café server.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.guild.members.fetch();
            const flagged = [];

            for (const member of interaction.guild.members.cache.values()) {
                if (member.user.bot) continue;
                const reasons = isLikelyAlt(member);
                if (reasons.length >= 2) {
                    flagged.push({ member, reasons });
                }
            }

            if (flagged.length === 0) {
                return interaction.editReply({ content: '✅ No likely alt accounts detected!' });
            }

            const PER_PAGE = 5;
            const page = (interaction.options.getInteger('page') || 1) - 1;
            const totalPages = Math.ceil(flagged.length / PER_PAGE);
            const slice = flagged.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

            const embed = new EmbedBuilder()
                .setTitle(`🔍 Alt Account Audit — ${flagged.length} Flagged`)
                .setColor(0xE74C3C)
                .setDescription(`Page ${page + 1}/${totalPages} • Use \`/auditalts page:[num]\` to navigate`)
                .setFooter({ text: 'Kavià Café • Alt Audit • Accounts flagged by 2+ criteria' })
                .setTimestamp();

            for (const { member, reasons } of slice) {
                embed.addFields({
                    name: `${member.user.tag} (${member.id})`,
                    value: `📅 Created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n📥 Joined: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n⚠️ Flags: ${reasons.map(r => `\`${r}\``).join(', ')}`,
                    inline: false
                });
            }

            const rows = [];
            const kickButtons = slice.map(({ member }) =>
                new ButtonBuilder()
                    .setCustomId(`auditalts_kick_${member.id}`)
                    .setLabel(`Kick ${member.user.username.substring(0, 15)}`)
                    .setStyle(ButtonStyle.Danger)
            );
            const dismissButtons = slice.map(({ member }) =>
                new ButtonBuilder()
                    .setCustomId(`auditalts_dismiss_${member.id}`)
                    .setLabel(`Dismiss`)
                    .setStyle(ButtonStyle.Secondary)
            );

            // Max 5 buttons per row
            if (kickButtons.length > 0) rows.push(new ActionRowBuilder().addComponents(kickButtons));
            if (dismissButtons.length > 0) rows.push(new ActionRowBuilder().addComponents(dismissButtons));

            await interaction.editReply({ embeds: [embed], components: rows });

        } catch (err) {
            console.error('Error in /auditalts:', err);
            try { await interaction.editReply({ content: '❌ Error running audit.' }); } catch {}
        }
    }
};