//---------------------------------------------
//  THIS CODE IS APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Designing Webs, Inc.  All rights reserved.
// ----------------------------------------------
var L_MINESWEEPER_BEGGINER = "BEGINNER";
var L_MINESWEEPER_INTERMEDIATE = "INTERMEDIATE";
var L_MINESWEEPER_EXPERT = "EXPERT";
var L_MINESWEEPER_CHOOSELEVEL = "<b>SELECT A LEVEL TO BEGIN</b><br> CTRL+CLICK to flag mines.";
var L_MINESWEEPER_YOUWON = "YOU WON!";
var L_MINESWEEPER_GAMEOVER = "SORRY. GAME OVER.";
var L_MINESWEEPER_MINES = "Mines: ";
var L_MINESWEEPER_TIMEGAMEOVER = "TIME. GAME OVER.";
var L_MINESWEEPER_TIME = "Time: 0";
var L_MINESWEEPER_TWOMINS = "Time: 02:00";


/////////////////////////////////////////////////////////////
function squares() {
	this.osquareState = "static";
	this.oMine = false;
	this.oMinesTouching = 0;
	this.divs = document.getElementsByTagName("div");
}

/////////////////////////////////////////////////////////////
function mineSweeper(rows, cols, mines) {
	this.oEnd = false;
	this.oAllFlags = 0;
	this.oPossibleMines = 0;
	this.oRows = parseInt(rows);
	this.oCols = parseInt(cols);
	this.oMines = parseInt(mines);
	this.oGridSize = this.oRows * this.oCols;
	this.oInnerHTML = "";
	this.oRowArray = new Array(rows);
	this.mouseDownTile = "";
	this.createBoard = function () {
		for (var i = 0; i < this.oCols; i++) {
			this.oRowArray[i] = new Array(this.oCols);
		}
		for (var i = 0; i < this.oRows; i++) {
			for (var j = 0; j < this.oCols; j++) {
				this.oRowArray[i][j] = new squares();
			}
		}
		for (var i = 0; i < this.oMines; i++) {
			var intMineRow = Math.floor(Math.random() * this.oRows);
			var intMineColumn = Math.floor(Math.random() * this.oCols);
			if (!this.oRowArray[intMineRow][intMineColumn].oMine) {
				this.oRowArray[intMineRow][intMineColumn].oMine = true;
			} else {
				i--;
			}
		}
		for (var i = 0; i < this.oRows; i++) {
			for (var j = 0; j < this.oCols; j++) {
				this.oInnerHTML += "<img src=\"images/unclicked.gif\" " + " id=\"square" + i + "-" + j + "\" border=\"0\" " + "onmouseover=\"oGame.mouseOver(this.id)\" " + "onmouseout=\"oGame.mouseOut(this.id)\" " + "onmousedown=\"oGame.mouseDown(this.id)\" " + "onmouseup=\"oGame.mouseUp(this.id)\" " + "onClick=\"oGame.passClick(this.id)\">";
				for (var k = -1; k < 2; k++) {
					for (var l = -1; l < 2; l++) {
						if (i + k >= 0 && i + k < this.oRows && j + l >= 0 && j + l < this.oCols) {
							if (this.oRowArray[i + k][j + l].oMine) {
								this.oRowArray[i][j].oMinesTouching++;
							}
						}
					}
				}
			}
			this.oInnerHTML += "<br>";
		}
		divs["mineBoard"].innerHTML = this.oInnerHTML;
	};
	this.passClick = function (squareName) {
		if (event.ctrlKey == true) {
			this.rightClick(squareName);
		} else {
			this.checkClick(squareName);
		}
	};
	this.mouseOver = function (squareName) {
		if (!this.oEnd) {
			var intMineRow = squareName.substring(6, squareName.indexOf("-"));
			var intMineColumn = squareName.substring(squareName.indexOf("-") + 1, squareName.length);
			if (this.oRowArray[intMineRow][intMineColumn].osquareState == "static") {
				document.images[squareName].src = "images/over.gif";
			}
		}
	};
	this.mouseOut = function (squareName) {
		if (!this.oEnd) {
			var intMineRow = squareName.substring(6, squareName.indexOf("-"));
			var intMineColumn = squareName.substring(squareName.indexOf("-") + 1, squareName.length);
			if (this.oRowArray[intMineRow][intMineColumn].osquareState == "static") {
				document.images[squareName].src = "images/unclicked.gif";
			}
		}
	};
	this.mouseDown = function (squareName) {
		this.mouseDownTile = squareName;
	};
	this.mouseUp = function (squareName) {
		if (squareName != this.mouseDownTile) {
			document.images[this.mouseDownTile].src = "images/unclicked.gif";
		}
	};
	this.checkClick = function (squareName) {
		if (!this.oEnd) {
			var intMineRow = squareName.substring(6, squareName.indexOf("-"));
			var intMineColumn = squareName.substring(squareName.indexOf("-") + 1, squareName.length);
			if (intGameTime == 120) {
				this.startGame();
			}
			if (this.oRowArray[intMineRow][intMineColumn].osquareState == "rightclicked") {
				return false;
			} else {
				if (this.oRowArray[intMineRow][intMineColumn].oMine) {
					this.endGame(0);
				} else {
					if (this.oRowArray[intMineRow][intMineColumn].oMinesTouching == 0) {
						this.displaySurroundings(intMineRow, intMineColumn);
					} else {
						this.oRowArray[intMineRow][intMineColumn].osquareState = "displayed";
						document.images[squareName].src = "images/" + this.oRowArray[intMineRow][intMineColumn].oMinesTouching + ".gif";
						this.oGridSize--;
						if (this.oGridSize == this.oMines) {
							this.endGame(1);
						}
					}
				}
			}
		}
	};
	this.rightClick = function (squareName) {
		if (!this.oEnd) {
			var intMineRow = squareName.substring(6, squareName.indexOf("-"));
			var intMineColumn = squareName.substring(squareName.indexOf("-") + 1, squareName.length);
			if (intGameTime == 120) {
				this.startGame();
			}
			if (this.oRowArray[intMineRow][intMineColumn].osquareState == "static") {
				this.oRowArray[intMineRow][intMineColumn].osquareState = "rightclicked";
				document.images[squareName].src = "images/flag.gif";
				this.oAllFlags++;
				updateMines();
			} else {
				if (this.oRowArray[intMineRow][intMineColumn].osquareState == "rightclicked") {
					this.oRowArray[intMineRow][intMineColumn].osquareState = "rightclickedtwice";
					document.images[squareName].src = "images/question.gif";
					this.oAllFlags--;
					this.oPossibleMines++;
					updateMines();
				} else {
					if (this.oRowArray[intMineRow][intMineColumn].osquareState == "rightclickedtwice") {
						this.oRowArray[intMineRow][intMineColumn].osquareState = "static";
						document.images[squareName].src = "images/unclicked.gif";
						this.oPossibleMines--;
					}
				}
			}
		}
	};
	this.displaySurroundings = function (intRow, intCol) {
		var intRow = parseInt(intRow);
		var intCol = parseInt(intCol);
		for (var k = -1; k < 2; k++) {
			for (var l = -1; l < 2; l++) {
				if (intRow + k >= 0 && intRow + k < this.oRows && intCol + l >= 0 && intCol + l < this.oCols) {
					if (this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].oMinesTouching == 0 && this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].osquareState != "displayed") {
						this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].osquareState = "displayed";
						this.displaySurroundings(parseInt(intRow + k), parseInt(intCol + l));
						document.images["square" + parseInt(intRow + k) + "-" + parseInt(intCol + l)].src = "images/" + this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].oMinesTouching + ".gif";
						this.oGridSize--;
						if (this.oGridSize == this.oMines) {
							this.endGame(1);
						}
					} else {
						if (this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].osquareState != "displayed") {
							this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].osquareState = "displayed";
							document.images["square" + parseInt(intRow + k) + "-" + parseInt(intCol + l)].src = "images/" + this.oRowArray[parseInt(intRow + k)][parseInt(intCol + l)].oMinesTouching + ".gif";
							this.oGridSize--;
							if (this.oGridSize == this.oMines) {
								this.endGame(1);
							}
						}
					}
				}
			}
		}
	};
	this.displayItems = function (strItem) {
		for (var i = 0; i < this.oRows; i++) {
			for (var j = 0; j < this.oCols; j++) {
				if (this.oRowArray[i][j].oMine) {
					document.images["square" + i + "-" + j].src = "images/" + strItem + ".gif";
				}
			}
		}
	};
	this.updateStatus = function (squareName) {
		var intMineRow = squareName.substring(6, squareName.indexOf("-"));
		var intMineColumn = squareName.substring(squareName.indexOf("-") + 1, squareName.length);
		return "[" + intMineRow + ":" + intMineColumn + "] [status: " + this.oRowArray[intMineRow][intMineColumn].osquareStateF + "] [isMine: " + this.oRowArray[intMineRow][intMineColumn].oMine + "] [surroundingMines: " + this.oRowArray[intMineRow][intMineColumn].oMinesTouching + "] - [Remaining Spaces: " + this.oGridSize + "]";
	};
	this.startGame = function () {
		intTimer = window.setTimeout("updateTime();", 100);
	};
	this.endGame = function (boolYouWon) {
		clearTimeout(intTimer);
		this.oEnd = true;
		if (boolYouWon) {
			this.displayItems("flag");
			divs["alertsText"].innerHTML = L_MINESWEEPER_YOUWON;
		} else {
			this.displayItems("mine");
			divs["alertsText"].innerHTML = L_MINESWEEPER_GAMEOVER;
		}
		divs["alerts"].style.visibility = "visible";
		divs["playAgain"].style.visibility = "visible";
	};
}						
   
/////////////////////////////////////////////////////////////
function updateMines() {
	divs["displayHolderMines"].innerHTML = L_MINESWEEPER_MINES;
	divs["displayHolderMines"].innerHTML += oGame.oMines - oGame.oAllFlags;
}
			
/////////////////////////////////////////////////////////////
function updateTime() {
	var zeroBuffer = "";
	if (!oGame.oEnd) {
		intGameTime--;
		secondsCounter -= 1;
		if (secondsCounter < 10) {
			zeroBuffer = "0";
		} else {
			zeroBuffer = "";
		}
		if (secondsCounter == -1) {
			minutesCounter -= 1;
			secondsCounter = 59;
			zeroBuffer = "";
		}
	}
	if (minutesCounter == -1 && secondsCounter == 59) {
		oGame.oEnd = true;
		minutesCounter = 0;
		secondsCounter = 0;
		if (secondsCounter < 10) {
			zeroBuffer = "0";
		}
		divs["displayHolderTime"].innerHTML = L_MINESWEEPER_TIME;
		divs["displayHolderTime"].innerHTML += minutesCounter + ":" + zeroBuffer + secondsCounter;
		divs["alertsText"].innerHTML = L_MINESWEEPER_TIMEGAMEOVER;
		divs["alerts"].style.visibility = "visible";
		divs["playAgain"].style.visibility = "visible";
	} else {
		divs["displayHolderTime"].innerHTML = L_MINESWEEPER_TIME;
		divs["displayHolderTime"].innerHTML += minutesCounter + ":" + zeroBuffer + secondsCounter;
		theTimer = window.setTimeout("updateTime();", 1000);
	}
}
						
/////////////////////////////////////////////////////////////
function init(level) {
	intGameTime = 120;
	switch (level) {
	  case 1:
		oGame = new mineSweeper(8, 8, 9);
		break;
	  case 2:
		oGame = new mineSweeper(8, 8, 15);
		break;
	  case 3:
		oGame = new mineSweeper(8, 8, 25);
		break;
	}
	oGame.createBoard();
	divs["mineBoard"].style.visibility = "visible";
	divs["displayHolder"].style.visibility = "visible";
	divs["formHolder"].style.visibility = "hidden";
	divs["alerts"].style.visibility = "hidden";
	divs["displayHolderTime"].innerHTML = L_MINESWEEPER_TWOMINS;
	divs["displayHolderMines"].innerHTML = L_MINESWEEPER_MINES;
	divs["displayHolderMines"].innerHTML += oGame.oMines - oGame.oAllFlags;
	document.body.style.backgroundImage = "url(images/background.png)";
	this.oDiv = divs["mineBoard"];
	oDiv.filters.item("DXImageTransform.Microsoft.alpha").opacity = 0;
	alphaIn(oDiv);
}

/////////////////////////////////////////////////////////////
function setUpGadget() {
	this.divs = document.getElementsByTagName("div");
	this.as = document.getElementsByTagName("a");
	this.oGame;
	this.minutesCounter = 1;
	this.secondsCounter = 60;
	divs["formHolder"].style.visibility = "hidden";
	divs["mineBoard"].style.visibility = "hidden";
	divs["alerts"].style.visibility = "hidden";
	divs["playAgain"].style.visibility = "hidden";
	divs["displayHolder"].style.visibility = "hidden";
	divs["formHolderDirections"].innerHTML = L_MINESWEEPER_CHOOSELEVEL;
	as["formField1"].innerHTML = L_MINESWEEPER_BEGGINER;
	as["formField2"].innerHTML = L_MINESWEEPER_INTERMEDIATE;
	as["formField3"].innerHTML = L_MINESWEEPER_EXPERT;
	document.body.style.direction = "ltr";
	document.body.style.backgroundImage = "url(images/cover.png)";
	setTimeout("setGame()", 500);
}

/////////////////////////////////////////////////////////////
function setGame() {
	this.oCover = divs["coverInner"];
	oCover.opacity = 100;
	alphaOut(oCover, 0);
	this.oMove = divs["formHolder"].style;
	moveRight(oMove, -150, 10);
	divs["formHolder"].style.visibility = "visible";
}

/////////////////////////////////////////////////////////////
function alphaIn(o) {
	this.oAlphaIn = o;
	this.oAlphaInFilter = oAlphaIn.filters.item("DXImageTransform.Microsoft.alpha");
	if (oAlphaInFilter.opacity < 100) {
		oAlphaInFilter.opacity += 10;
		setTimeout("alphaIn(oAlphaIn)", 50);
	}
}

/////////////////////////////////////////////////////////////
function alphaOut(o, endAlpha) {
	this.oEndAlpha = endAlpha;
	this.oAlphaOut = o;
	this.oAlphaOutFilter = oAlphaOut.filters.item("DXImageTransform.Microsoft.alpha");
	if (oAlphaOutFilter.opacity > oEndAlpha) {
		oAlphaOutFilter.opacity -= 10;
		setTimeout("alphaOut(oAlphaOut, oEndAlpha)", 50);
	}
	if (oAlphaOutFilter.opacity == 0) {
		oAlphaOut.style.visibility = "hidden";
	}
}

/////////////////////////////////////////////////////////////
function moveRight(oMove, oPos, oEnd) {
	this.oEnd = oEnd;
	if (oPos < oEnd) {
		oMove.left = oPos;
		newPos = oPos + 10;
		setTimeout("moveRight(oMove, newPos, oEnd)", 24);
	}
}

