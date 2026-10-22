// array to hold each eighth note of the song
var currentSong = Array();
var songInterval;
var songPointer = 0;

// in: dash delimited eighth notes, tempo in beats per minute
function playSong(song, tempo) {

	// calculate the millisecond equivalent of the bpm (in eighth notes)
	var tempoMS = 1000*30/tempo;

	// clear previous interval if it was playing
	clearInterval(songInterval);
	songPointer = 0;

	// assign song notes to array;
	currentSong = song.split(' ');

	// start the song interval
	songInterval = setInterval(songStep, tempoMS);
}


// step through each increment in a song.
function songStep() {

	// play a semitone or a tone?
	if (currentSong[songPointer].charAt(0) == 's')
		playSemitone(currentSong[songPointer].substring(1));
	else
		playNote(currentSong[songPointer]);

	// step further through the song
	songPointer++;

	// stop playing if at the end of the song
	if (songPointer >= currentSong.length)
	{
		songPointer = 0;
		clearInterval(songInterval);
	}
}