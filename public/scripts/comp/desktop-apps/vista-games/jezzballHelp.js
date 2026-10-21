// JezzBall's help (JEZZBALL.HLP, WinHelp 3.0), its topics as the help file has them: the text is
// the file's own (decompressed from |TOPIC), the links are its jumps ({j:Topic|label}) and
// popups ({p:Topic|label}), {b:...} its bold runs. jezzball.js shows them in a Windows Help
// window (Vista has no WinHlp32 for a 16-bit program's .HLP without an update).
(function (root) {
    'use strict';

    const SEE_ALSO = (list) => 'See Also\n' + list.map((t) => '{j:' + t + '|' + t + '}').join('\n');

    const TOPICS = {
        contents: {
            title: 'JezzBall Help Contents',
            body: [
                'The Contents lists all JezzBall Help topics. To learn how to use Help, choose How to Use Help from the Help menu, or press {b:F1}.',
                '#How to Play',
                '{j:Overview of JezzBall|Overview}\n{j:Playing the Game|Playing the Game}\n{j:Rules of the Game|Rules of the Game}\n{j:Scoring|Scoring}\n{j:Strategy and Hints|Strategy and Hints}',
                '#Commands',
                '{j:Game Menu Commands|Game Menu Commands}\n{j:Options Menu Commands|Options Menu Commands}'
            ]
        },
        'Overview of JezzBall': {
            title: 'Overview',
            body: [
                'On a far-off world, a new kind of atom has been discovered. It\'s called a Jezz, and you get paid galactic credits each time you trap one for shipment back to Earth. The Jezz atoms preserve their energy best when tightly confined, so the smaller the chamber you trap them in, the more galactic credits you acquire.',
                'The game begins in a large capture chamber with two Jezz atoms bouncing around. With a click of the mouse, you can build a new chamber wall and trap the Jezz atoms in a smaller space. But be careful, if you don\'t build your wall completely across the chamber before it\'s hit by a Jezz atom, it won\'t withstand the impact.',
                'Be forewarned, JezzBall is not just challenging and great fun, but also strangely soothing and satisfying. Once you start trapping atoms, you won\'t want to stop!',
                SEE_ALSO(['Playing the Game', 'Rules of the Game', 'Scoring', 'Strategy and Hints'])
            ]
        },
        'Playing the Game': {
            title: 'Playing the Game',
            body: [
                'The object of JezzBall is to trap Jezz atoms in the smallest possible chambers. You make the chambers smaller with the {p:wallbuilder|wallbuilder}. Watch the Jezz atoms closely. The challenge is to gauge enough time to anchor your wall on both sides of the chamber before it is struck by an atom. If only one side of your wall anchors before being hit by an atom, a partial wall is left behind but the cost is one chamber life.',
                'You advance to the next level when the walls you build reduce the chamber by at least 75 percent. If you reduce the chamber more than 75 percent, you are awarded extra points. Each time you advance a level, an additional Jezz atom is placed in the chamber. The more atoms you work with, the higher your points. If the atoms are moving too fast, you can slow them down, but you\'ll only earn half as many points.',
                'There is a time limit for each game level in JezzBall. The more atoms at play in the capture chamber, the more time you are allotted for trapping them. The countdown clock is shown in the upper-right corner of the screen.',
                '#To select the speed level',
                'From the Options menu, choose either Slow or Fast.',
                'At slow speed the atoms move slower, but so does the wallbuilder.',
                '#To start a new game',
                'From the Game menu, choose New Game, or press {b:F2.}',
                'You can start a new game at any time, even when a game is in progress.',
                '#To build a wall',
                '1\tMove the mouse until the wallbuilder is where you want it.',
                '2\tClick the right button to change between vertical and horizontal wallbuilding positions.',
                '\tThe double-headed arrow changes to indicate the vertical or horizontal position.',
                '3\tClick the left button to start building a wall.',
                '#To pause a game',
                'From the Game menu, click Pause, or press {b:F3}.',
                'When the game is paused, the countdown clock stops. You can resume the game by choosing Pause again, pressing {b:F3}, or clicking the Paused button in the middle of the capture chamber.',
                SEE_ALSO(['Rules of the Game', 'Scoring', 'Strategy and Hints', 'Overview of JezzBall'])
            ]
        },
        'Rules of the Game': {
            title: 'Rules of the Game',
            body: [
                'The rules for JezzBall are simple:',
                'Trap the Jezz atoms into smaller spaces in order to make at least 75 percent of the chamber disappear. You can check on your progress by looking at the {p:area cleared|area cleared} at the bottom of the screen.',
                'The {p:wallbuilder|wallbuilder} can sustain only a limited number of atomic hits. Each time it is hit, it loses one chamber life. The number of lives left is displayed in the upper-left corner of the screen.',
                'If two atoms are free in the chamber, a wall in progress can be hit once. A second hit by a Jezz atom ends the game. You are allowed an additional hit for each atom in the chamber. For example, at level 7, the wallbuilder can sustain six hits, with the game ending on the seventh. A game ends when the wallbuilder is destroyed by atoms or when you run out of time.',
                'The time left in the game is shown in the upper-right corner of the screen. Playing time is increased for each level of complexity. The more atoms in play, the more time you have to trap them.',
                'Each time you succeed in eliminating at least 75 percent of the chamber, you advance to the next level and an additional Jezz atom pops into play.',
                SEE_ALSO(['Scoring', 'Strategy and Hints', 'Overview of JezzBall', 'Playing the Game'])
            ]
        },
        Scoring: {
            title: 'Scoring',
            body: [
                'JezzBall computes your score based upon how much of the capture chamber you can eliminate.',
                'The chamber is divided into squares. You get points for each square that you eliminate, including those squares knocked out by the {p:wallbuilder|wallbuilder} and empty areas that are cut off from the chamber. At the beginning level, with two atoms, and at slow speed, you receive 3.5 points for each square eliminated, 70 points for each vertical column, and 98 points for each horizontal column. At fast speed the points are doubled. The greater the number of atoms in the chamber, the more points you are awarded for each square that you eliminate.',
                'Bonus points are awarded at the completion of each level based upon how completely you eliminated the squares of the capture chamber. The first level of bonus points is given for each percent of space eliminated above 80 percent. The second level of bonus points kicks in for each percentage eliminated above 90 percent. These bonus points increase according to how many atoms are in play.',
                '#To see the highest scores',
                'From the Game menu, choose High Scores.',
                SEE_ALSO(['Strategy and Hints', 'Overview of JezzBall', 'Playing the Game', 'Rules of the Game'])
            ]
        },
        'Strategy and Hints': {
            title: 'Strategy and Hints',
            body: [
                'This section contains helpful hints for playing JezzBall successfully.',
                'Start playing with the game set at slow speed. You only get half the points, but you can enjoy the game while developing your own strategies.',
                'Build vertical walls first. Because the screen is rectangular, vertical walls aren\'t as long as horizontal walls, and you get a little more bounce time to complete the span.',
                'Keep the {p:wallbuilder|wallbuilder} away from the sides of the chamber. Since walls grow in two directions at once, take full advantage of this by centering the wallbuilder.',
                'Try to divide the group of atoms with each wall you build. This is especially important when playing at levels with multiple atoms. If you don\'t divide the atoms into smaller groups, each wall becomes more difficult to build because the same number of atoms are bouncing through an ever smaller space.',
                'For higher scores, take your time on the lower levels. Remember that you get bonus points for eliminating more than 80 percent of the chamber, and additional bonus points for eliminating more than 90 percent. So on the early levels, see how precisely you can isolate the atoms.',
                'Learn game techniques by choosing Demo from the Game menu. Especially fun is the trap-building technique in which a long, narrow stovepipe channel is created. As an atom bounces deeply into the channel, a wall is built to close off one atom while leaving room for another.',
                'Use partial walls to divide large groups of atoms into smaller populations. Begin with the wallbuilder nearer to one side of the chamber so at least one end of the wall anchors into place before the first collision. You lose one life with this strategy, but it can help to tame a chamber filled with Jezz atoms!',
                'Always check the wallbuilder before clicking. Is the double-headed arrow pointing vertically or horizontally? It\'s frustrating to be all set to close a trap with a vertical wall, only to click and see that your wall is growing horizontally.',
                'To reduce JezzBall to an icon, press the {b:ESC} key or click the Minimize button. The countdown clock stops when you minimize JezzBall.',
                SEE_ALSO(['Overview of JezzBall', 'Playing the Game', 'Rules of the Game', 'Scoring'])
            ]
        },
        'How To Play': {
            title: 'How to Play',
            body: [
                'This section contains information on how to play JezzBall.',
                '{j:Overview of JezzBall|Overview}\n{j:Playing the Game|Playing the Game}\n{j:Rules of the Game|Rules of the Game}\n{j:Scoring|Scoring}\n{j:Strategy and Hints|Strategy and Hints}'
            ]
        },
        Commands: {
            title: 'Commands',
            body: [
                'This section contains information about commands in JezzBall.',
                '{j:Game Menu Commands|Game Menu Commands}\n{j:Options Menu Commands|Options Menu Commands}'
            ]
        },
        'Game Menu Commands': {
            title: 'Game Menu Commands',
            body: [
                'This section contains information about Game menu commands in JezzBall.',
                '#New Game',
                'Starts a new game.',
                '#Pause',
                'Stops the timer and pauses the game.',
                'You can resume a paused game by choosing Pause again, pressing {b:F3,} or clicking the Paused button in the middle of the capture chamber.',
                '#Demo',
                'Plays a demonstration, showing strategies for the game.',
                '#High Scores',
                'Displays the High Scores table.',
                '#Exit',
                'Quits JezzBall. You can quit at any time, even in the middle of a game.'
            ]
        },
        'Options Menu Commands': {
            title: 'Options Menu Commands',
            body: [
                'This section contains information about the Options menu commands in JezzBall.',
                '#Slow',
                'Reduces both the speed of the Jezz atoms and the speed of the {p:wallbuilder|wallbuilder}. In addition, you acquire only half as many points as when playing at fast speed.',
                '#Fast',
                'The speed of the game when you first start playing JezzBall.',
                '#Sound',
                'Turns game sounds on and off.',
                'A check mark is displayed beside the command name when the sound is turned on.',
                '{b:Note}   You need a sound card and a sound driver to hear game sounds.'
            ]
        },
        wallbuilder: {
            popup: true,
            title: 'wallbuilder',
            body: ['{b:wallbuilder}', 'The wallbuilder is represented by a double-headed arrow. When the arrow points up and down, you can build a vertical wall. When the arrow points left and right, you can build a horizontal wall. Click the right mouse button to change from vertical to horizontal positions. Click the left mouse button to start building walls.']
        },
        'area cleared': {
            popup: true,
            title: 'area cleared',
            body: ['{b:area cleared}', 'Displays what percent of the chamber has been cleared.']
        }
    };

    // the order of the browse buttons (<< >>), as the file's browse sequence
    const BROWSE = ['Overview of JezzBall', 'Playing the Game', 'Rules of the Game', 'Scoring', 'Strategy and Hints', 'Game Menu Commands', 'Options Menu Commands'];

    root.JezzBallHelpTopics = { TOPICS, BROWSE };
})(window);
