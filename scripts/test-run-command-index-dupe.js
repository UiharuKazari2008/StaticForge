// JULES: regression test for runCommandIndex NAX gallery filtering deduplication
const assert = require('assert');

function filterGalleriesOld(galleries, isArtistHint, isNaxtHint) {
    let galleriesToSearch = galleries;
    if (isArtistHint) {
        galleriesToSearch = galleries.filter((g) => String(g.slug || '').toLowerCase().includes('artist'));
    } else if (!isNaxtHint) {
        galleriesToSearch = galleries.filter((g) => String(g.slug || '').toLowerCase().includes('artist'));
    }
    const maxGalleries = isNaxtHint ? 6 : 3;
    return galleriesToSearch.slice(0, maxGalleries);
}

function filterGalleriesNew(galleries, isArtistHint, isNaxtHint) {
    let galleriesToSearch = galleries;
    if (isArtistHint || !isNaxtHint) {
        galleriesToSearch = galleries.filter((g) => String(g.slug || '').toLowerCase().includes('artist'));
    }
    const maxGalleries = isNaxtHint ? 6 : 3;
    return galleriesToSearch.slice(0, maxGalleries);
}

const mockGalleries = [
    { slug: 'anime-artist-style' },
    { slug: 'general-tags' },
    { slug: 'artist-masterpieces' },
    { slug: 'concept-art' },
    { slug: 'featured-artists' },
    { slug: 'character-features' }
];

const testCases = [
    { isArtistHint: true, isNaxtHint: false },
    { isArtistHint: false, isNaxtHint: true },
    { isArtistHint: false, isNaxtHint: false },
    { isArtistHint: true, isNaxtHint: true }
];

testCases.forEach(({ isArtistHint, isNaxtHint }) => {
    const oldRes = filterGalleriesOld(mockGalleries, isArtistHint, isNaxtHint);
    const newRes = filterGalleriesNew(mockGalleries, isArtistHint, isNaxtHint);
    assert.deepStrictEqual(newRes, oldRes, `Mismatch for isArtistHint=${isArtistHint}, isNaxtHint=${isNaxtHint}`);
});

console.log('✅ NAX gallery filtering deduplication test passed!');
