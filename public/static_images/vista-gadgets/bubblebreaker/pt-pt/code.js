var maxDockedWidth      = 130;
var maxDockedHeight     = 149;
var maxUndockedWidth    = 218;
var maxUndockedHeight   = 237;

var xlen = 11;
var ylen = 11;
var bigballs = false;
var numBalls = 5;
var L_HIGHSCORE = 'Melhor Pontuação';
var L_SCORE = 'Pontuação';
var board;
var highscore = 0;
var score = 0;
var selected_board;

function Loader() {
	setup();
    System.Gadget.onUndock = checkState;
    System.Gadget.onDock = checkState;
	
	highscore = parseInt(System.Gadget.Settings.read("highscore"));
	if (isNaN(highscore)) 
		highscore = 0;
	score = 0;
	
	board = new Array(ylen);
	selected_board = new Array(ylen);
	for (var line=0; line<ylen; line++) {
		board[line] = new Array(xlen);
		selected_board[line] = new Array(xlen);
		for (var col=0; col<xlen; col++) {
			board[line][col] = 1 + Math.round((numBalls - 1)*Math.random());
			selected_board[line][col] = 0;
		}	
	}
	
	checkState();
	drawBoard();
	if (boardtable!=null) {
		boardtable.filters[0].Apply();                   
		boardtable.filters[0].Play();
	}
}

function checkState() {
    if(!System.Gadget.docked)
        undockedState();
    else if (System.Gadget.docked)
        dockedState();
	drawBoard();
}

function undockedState() {
    gUndockFlag = true;
	bigballs = true;
    with (document.body.style)
		width = maxUndockedWidth, height = maxUndockedHeight;
    with (puzzleBg.style)
		width = maxUndockedWidth, height = maxUndockedHeight;
	newgame.style.left = (maxUndockedWidth - 38) + "px";
	highscores.style.left = (maxUndockedWidth - 20) + "px";

    puzzleBg.src="url(../images/bigbg.png)";
}

function dockedState() {   
	bigballs = false;
    with(document.body.style)
        width=maxDockedWidth, height=maxDockedHeight;
    with(puzzleBg.style)
        width=maxDockedWidth, height=maxDockedHeight;
	newgame.style.left = (maxDockedWidth - 38) + "px";
	highscores.style.left = (maxDockedWidth - 20) + "px";
		
    puzzleBg.src="url(../images/bg.png)";      
}

function getElementsByClass(node, searchClass, tag) {
	var classElements = new Array();
	var els = node.getElementsByTagName(tag); // use "*" for all elements
	var elsLen = els.length;
	var pattern = new RegExp("\\b"+searchClass+"\\b");
	for (i = 0, j = 0; i < elsLen; i++) {
		if ( pattern.test(els[i].className) ) {
			classElements[j] = els[i];
	 		j++;
		}
	}
	return classElements;
}

function drawBoard() {
	var scorediv = document.getElementById('scorediv');
	if (scorediv!=null)
		scorediv.innerHTML = L_SCORE + ':&nbsp;' + score;
	var cells = document.getElementsByTagName("td"); 
	for (var i = 0; i < cells.length; i++) { 
		var column = cells[i].getAttribute("column"); 
		var line = cells[i].getAttribute("line"); 
		if (column!=null && line!=null) {
			var cor = board[line-1][column-1];
			if (cor == 0)
				cells[i].className = ((bigballs)?'big':'') + 'block';
			else
				if (selected_board[line-1][column-1] == 1) {
					cells[i].className = ((bigballs)?'big':'') + 'block' + cor + 'sel';
				} else {
					cells[i].className = ((bigballs)?'big':'') + 'block' + cor;
				}
		}
	}
}

function setup() {
	var aEl = getElementsByClass(document,'block','*');
	for (var i=0; i<aEl.length; i++)
		aEl[i].onclick = clique;	
}

function updateHighscore() {
	if (score > highscore) {
		highscore = score;
		System.Gadget.Settings.write("highscore", score);
	}	
}

function showHighscore() {
	maxWidth = (bigballs) ? maxUndockedWidth : maxDockedWidth;
	maxHeight = (bigballs) ? maxUndockedWidth : maxDockedWidth;
	winMessage.style.left = ((maxWidth - 100) / 2) + "px";
	winMessage.style.top = ((maxHeight - 46) / 2) + "px";
	winMessageText.innerHTML = L_HIGHSCORE + ':&nbsp;' + highscore;
	winMessage.style.visibility = 'visible';
	winMessage.style.filter = "alpha(opacity=100)";
	setTimeout("winMessageDisplay(100, null);", 1500);
}

function winMessageDisplay(val, func) {
    winMessage.style.visibility = 'visible';
    if (val > 0) {
        val -= 2;
        winMessage.style.filter = "alpha(opacity=" + val + ")";
        setTimeout("winMessageDisplay(" + val + ", " + func + ");", 10);
    } else {
        winMessage.style.visibility = 'hidden';
		if (func != null)
			func();
    }
}

function collapseBalls() {
	for (var line=0; line<ylen; line++)
		for (var col=0; col<xlen; col++)
			if (selected_board[line][col])
				board[line][col] = 0;
				
	for (var col=(xlen-1); col>0; col--)
		if (emptyCol(col))
			for (var newcol=(col-1); newcol>=0; newcol--) {
				if (!emptyCol(newcol)) {
					moveCol(newcol, col);
					break;
				}
			}
	
	for (var col=0; col<xlen; col++) {
		var vazios = 0;
		for (var line=(ylen-1); line>=0; line--) {
			if(board[line][col] == 0) {
				vazios++;
			} else if (vazios > 0) {
				board[line+vazios][col] = board[line][col];
				board[line][col] = 0;
			}
		}
	}
			
}

function emptyCol(col) {
	for (var line=0; line<ylen; line++)
		if (board[line][col] > 0)
			return false;
	return true;
}

function moveCol(srccol, destcol) {
	for (var line=0; line<ylen; line++) {
		board[line][destcol] = board[line][srccol];
		board[line][srccol] = 0;
	}
}

function clique() {
	var line = this.getAttribute("line")-1, column = this.getAttribute("column")-1;
	var cor = board[line][column];
	if (selected_board[line][column] == 1) {
		score += qtdScore(countSelected());
		collapseBalls();
		resetSelected();
	} else {
		resetSelected();
		selectBalls(line, column, cor);
		if (countSelected() <= 1) 
			resetSelected();
	}
	drawBoard();
	updateHighscore();
}

function qtdScore(balls) {
	if (balls > 29) balls = 29;
	return (balls * (balls - 1));
}

function resetSelected() {
	for (var line=0; line<ylen; line++)
		for (var col=0; col<xlen; col++)
			selected_board[line][col] = 0;
}

function countSelected() {
	var count = 0;
	for (var line=0; line<ylen; line++)
		for (var col=0; col<xlen; col++)
			if (selected_board[line][col])
				count += 1;
	return count;
}

function selectBalls(line, column, cor) {
	if (line >= ylen || column >= xlen || line < 0 || column < 0)
		return;
	if (board[line][column] != cor || selected_board[line][column])
		return;
	selected_board[line][column] = 1;
	selectBalls(line, column+1, cor);
	selectBalls(line+1, column, cor);
	selectBalls(line-1, column, cor);
	selectBalls(line, column-1, cor);
}

function SimpleSwap(el, src){
	el.src=src;
}
