const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Review } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reviews')
        .setDescription('View reviews for a staff member')
        .addUserOption(option =>
            option.setName('staff').setDescription('Staff member to view reviews for').setRequired(true)),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});

        try {
            const staff = interaction.options.getUser('staff');
            const realReviews = await Review.find({ staffId: staff.id });

            // Layer troll reviews on top (in memory only, never saved)
            const trollCount = client.trollReviews?.get(staff.id) || 0;

            const allReviews = [...realReviews];
            for (let i = 0; i < trollCount; i++) {
                allReviews.push({ rating: 1, _fake: true });
            }

            if (allReviews.length === 0) {
                return interaction.editReply({ content: `❌ **${staff.tag}** has no reviews yet.` });
            }

            const total = allReviews.length;
            const avg = (allReviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1);
            const fiveStars = allReviews.filter(r => r.rating === 5).length;
            const fourStars = allReviews.filter(r => r.rating === 4).length;
            const threeStars = allReviews.filter(r => r.rating === 3).length;
            const twoStars = allReviews.filter(r => r.rating === 2).length;
            const oneStar = allReviews.filter(r => r.rating === 1).length;

            const starsDisplay = (count, total) => {
                const pct = total > 0 ? Math.round((count / total) * 10) : 0;
                return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${count}`;
            };

            const trollNote = trollCount > 0
                ? `\n\n🤡 *${trollCount} totally real and definitely not fake 1-star reviews included*`
                : '';

            const embed = new EmbedBuilder()
                .setTitle(`⭐ Reviews — ${staff.tag}`)
                .setColor(trollCount > 0 ? 0xE74C3C : 0xF39C12)
                .setThumbnail(staff.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '⭐ Average Rating', value: `**${avg}/5** from **${total}** review${total !== 1 ? 's' : ''}${trollNote}`, inline: false },
                    { name: '5 ⭐', value: starsDisplay(fiveStars, total), inline: false },
                    { name: '4 ⭐', value: starsDisplay(fourStars, total), inline: false },
                    { name: '3 ⭐', value: starsDisplay(threeStars, total), inline: false },
                    { name: '2 ⭐', value: starsDisplay(twoStars, total), inline: false },
                    { name: '1 ⭐', value: starsDisplay(oneStar, total), inline: false }
                )
                .setFooter({ text: 'Kavià Café • Staff Reviews' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Error in /reviews:', err);
            try { await interaction.editReply({ content: '❌ Error fetching reviews.' }); } catch {}
        }
    }
};