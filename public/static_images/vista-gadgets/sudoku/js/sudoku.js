////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var g_board = {};

var board = [];
var player = [];

var difficulty = [
                  [4,3,4,3,4,3,4,3,4],
                  [3,3,3,3,3,3,3,3,3],
                  [3,2,3,2,3,2,3,2,3],
                  [2,2,2,2,2,2,2,2,2]
                 ];
                 
var matrix = [
              [0,0],[0,1],[0,2],
              [1,0],[1,1],[1,2],
              [2,0],[2,1],[2,2]
             ];

var level = 0;
var end = false;

var bitFull = 0;

for (var i = 1; i <= 9; i++)
{
    bitFull |= (1<<i);
}
////////////////////////////////////////////////////////////////////////////////
//
// Load main gadget function
//
////////////////////////////////////////////////////////////////////////////////
function load()
{
    System.Gadget.onUndock = undocked;
    System.Gadget.onDock = docked;
    
    System.Gadget.settingsUI = "settings.html";
    System.Gadget.onSettingsClosed = settingsClosed;
    
    document.onkeypress = keypress;
    
    loadSudoku();
}
////////////////////////////////////////////////////////////////////////////////
//
// Load Sudoku board
//
////////////////////////////////////////////////////////////////////////////////
function loadSudoku()
{
    var settingsExist = System.Gadget.Settings.read("SettingsExist");
    
    if (settingsExist)
    {
        level = parseInt(System.Gadget.Settings.read("GameLevel"));
        
        if (!level)
        {
            level = 0;
        }
    }
    
    end = false;        
    var loaded = false;
    
    do
    {
        loaded = sudokuBoard();
    }
    while (loaded == false)

    loaded = false;
    
    do
    {
        loaded = sudokuPlayer();
    }
    while (loaded == false)
    
    if (System.Gadget.docked)
    {
        docked();
    }
    else
    {
        undocked();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Docked mode
//
////////////////////////////////////////////////////////////////////////////////
function docked()
{
    g_board = {
        body: {
            width: 130,
            height: 198,
            image: "images/sudoku_bgDocked.png"
        },
        text: {
            size: 8,
            border: 1,
            padding: 1
        },
        x: 2,
        y: 30,
        tile: {
            width: 12,
            height: 12,
            spacing: 1
        },
        grid: {
            spacing: 4
        },
        buttons: {
            width: 22,
            height: 17,
            hint: {
                left: 10,
                top: 5
            },
            check: {
                left: 38,
                top: 5
            },
            solve: {
                left: 67,
                top: 5
            },
            restart: {
                left: 95,
                top: 5
            }
        },
        keypad: {
            width: 12,
            height: 12,
            _1: {
                left: 30,
                top: 163
            },
            _2: {
                left: 44,
                top: 163
            },
            _3: {
                left: 58,
                top: 163
            },
            _4: {
                left: 73,
                top: 163
            },
            _5: {
                left: 87,
                top: 163
            },
            _6: {
                left: 32,
                top: 178
            },
            _7: {
                left: 45,
                top: 178
            },
            _8: {
                left: 59,
                top: 178
            },
            _9: {
                left: 74,
                top: 178
            },
            _x: {
                left: 88,
                top: 178
            },
            click: null,
            hover: null
        }
    }
    
    position();
}
////////////////////////////////////////////////////////////////////////////////
//
// Undocked mode
//
////////////////////////////////////////////////////////////////////////////////
function undocked()
{
    g_board = {
        body: {
            width: 375,
            height: 434,
            image: "images/sudoku_bgUndocked.png"
        },
        text: {
            size: 26,
            border: 2,
            padding: 1
        },
        x: 10,
        y: 48,
        tile: {
            width: 36,
            height: 36,
            spacing: 2
        },
        grid: {
            spacing: 2
        },
        buttons: {
            width: 80,
            height: 25,
            hint: {
                left: 18,
                top: 16
            },
            check: {
                left: 100,
                top: 16
            },
            solve: {
                left: 184,
                top: 16
            },
            restart: {
                left: 266,
                top: 16
            }
        },
        keypad: {
            width: 22,
            height: 22,
            _1: {
                left: 48,
                top: 395
            },
            _2: {
                left: 75,
                top: 395
            },
            _3: {
                left: 102,
                top: 395
            },
            _4: {
                left: 129,
                top: 395
            },
            _5: {
                left: 157,
                top: 395
            },
            _6: {
                left: 184,
                top: 395
            },
            _7: {
                left: 211,
                top: 395
            },
            _8: {
                left: 238,
                top: 395
            },
            _9: {
                left: 265,
                top: 395
            },
            _x: {
                left: 293,
                top: 395
            },
            click: null,
            hover: null
        }
    }
    
    position();
}
////////////////////////////////////////////////////////////////////////////////
//
// Position board elements
//
////////////////////////////////////////////////////////////////////////////////
function position()
{
    with (document.body.style)
    {
        width = g_board.body.width + "px";
        height = g_board.body.height + "px";
        background = "url(" + g_board.body.image + ") no-repeat";
    }
    
    with (sudokuHint.style)
    {
        left = g_board.buttons.hint.left + "px";
        top = g_board.buttons.hint.top + "px";
        width = g_board.buttons.width + "px";
        height = g_board.buttons.height + "px";
    }
    
    with (sudokuCheck.style)
    {
        left = g_board.buttons.check.left + "px";
        top = g_board.buttons.check.top + "px";
        width = g_board.buttons.width + "px";
        height = g_board.buttons.height + "px";
    }
    
    with (sudokuSolve.style)
    {
        left = g_board.buttons.solve.left + "px";
        top = g_board.buttons.solve.top + "px";
        width = g_board.buttons.width + "px";
        height = g_board.buttons.height + "px";
    }
    
    with (sudokuRestart.style)
    {
        left = g_board.buttons.restart.left + "px";
        top = g_board.buttons.restart.top + "px";
        width = g_board.buttons.width + "px";
        height = g_board.buttons.height + "px";
    }
    
    for (var i = 1; i <= 9; i++)
    {
        with (document.getElementById("keypad_" + i).style)
        {
            left = eval("g_board.keypad._" + i + ".left") + "px";
            top = eval("g_board.keypad._" + i + ".top") + "px";
            width = g_board.keypad.width + "px";
            height = g_board.keypad.height + "px";
        }
    }
    
    with (keypad_x.style)
    {
        left = g_board.keypad._x.left + "px";
        top = g_board.keypad._x.top + "px";
        width = g_board.keypad.width + "px";
        height = g_board.keypad.height + "px";
    }
    
    for (var i = 0; i < 9; i++)
    {
        for (var j = 0; j < 9; j++)
        {
            with (document.getElementById("square_" + i + "_" + j))
            {
                style.left = g_board.x + (j * g_board.tile.width) + (Math.floor(j / 3) * g_board.grid.spacing) + (j * g_board.tile.spacing) + "px";
                style.top = g_board.y + (i * g_board.tile.height) + (Math.floor(i / 3) * g_board.grid.spacing) + (i * g_board.tile.spacing) + "px";
                style.width = g_board.tile.width + "px";
                style.height = g_board.tile.height + "px";
                style.fontSize = g_board.text.size + "px";
                style.color = (player[i][j][1] ? "#666666" : "#000000");
                style.paddingTop = g_board.text.padding + "px";
                innerHTML = (player[i][j][0] != null ? player[i][j][0] : '<img src="images/spacer.gif" style="width:1px;height:1px" />');
            }
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Validate player input
//
////////////////////////////////////////////////////////////////////////////////
function check(insert, win)
{
    var errors = 0;
    
    for (var i = 0; i < 9; i++)
    {
        for (var j = 0; j < 9; j++)
        {
            if (player[i][j][0] != null && player[i][j][0] != board[i][j])
            {
                if (insert == null)
                {
                    with (document.getElementById("square_" + i + "_" + j))
                    {
                        style.color = "red";
                    }
                }
                
                errors++;
            }
            else if (player[i][j][0] == null)
            {
                errors++;
            }
            else if (win && !player[i][j][1])
            {
                with (document.getElementById("square_" + i + "_" + j))
                {
                    style.color = "green";
                }
            }
        }
    }
    
    if (insert && errors == 0)
    {
        end = true;
        check(false, true);
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Solve game
//
////////////////////////////////////////////////////////////////////////////////
function solve()
{
    for (var i = 0; i < 9; i++)
    {
        for (var j = 0; j < 9; j++)
        {
            if (!player[i][j][1])
            {
                with (document.getElementById("square_" + i + "_" + j))
                {
                    style.color = "#000000";
                    innerHTML = board[i][j];
                }
            }

            player[i][j][0] = board[i][j];
        }
    }
    
    end = true;
    
    if (g_board.keypad.click != null)
    {
        enableBorder(false, g_board.keypad.click.x, g_board.keypad.click.y);
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Restart game
//
////////////////////////////////////////////////////////////////////////////////
function restart()
{
    for (var i = 0; i < 9; i++)
    {
        for (var j = 0; j < 9; j++)
        {
            with (document.getElementById("square_" + i + "_" + j))
            {
                innerHTML = '<img src="images/spacer.gif" style="width:1px;height:1px" />';
            }
        }
    }
    
    loadSudoku();
}
////////////////////////////////////////////////////////////////////////////////
//
// Insert number by player
//
////////////////////////////////////////////////////////////////////////////////
function insert(num)
{
    if (g_board.keypad.click != null || g_board.keypad.hover != null)
    {
        var intX, intY;
        
        if (g_board.keypad.click != null)
        {
           intX =  g_board.keypad.click.x;
           intY = g_board.keypad.click.y;
        }
        else
        {
           intX =  g_board.keypad.hover.x;
           intY = g_board.keypad.hover.y;
        }

        if (!player[intY][intX][1])
        {
            player[intY][intX][0] = num;
            
            with (document.getElementById("square_" + intY + "_" + intX))
            {
                style.color = "#000000";
                style.border = "";
                innerHTML = (num ? num : '<img src="images/spacer.gif" style="width:1px;height:1px" />');
            }
        }
        
        g_board.keypad.click = null;
        g_board.keypad.hover = null;
        
        check(true);
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Load game after settings is closed
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        loadSudoku();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Define actions for keyboard number presses
//
////////////////////////////////////////////////////////////////////////////////
function keypress()
{
    switch (event.keyCode)
    {
        case 49:
            insert(1);
            break;
        case 50:
            insert(2);
            break;
        case 51:
            insert(3);
            break;
        case 52:
            insert(4);
            break;
        case 53:
            insert(5);
            break;
        case 54:
            insert(6);
            break;
        case 55:
            insert(7);
            break;
        case 56:
            insert(8);
            break;
        case 57:
            insert(9);
            break;
        case 120:
            insert(null);            
            break;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Show next hint
//
////////////////////////////////////////////////////////////////////////////////
function hint()
{
    var unused = available();
    
    if (unused.length > 0)
    {
        var k = unused[Math.floor(Math.random()*unused.length)];
        player[k[0]][k[1]][0] = board[k[0]][k[1]];
        
        with (document.getElementById("square_" + k[0] + "_" + k[1]))
        {
            style.color = "#000000";
            innerHTML = player[k[0]][k[1]][0];
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Check for non-displayed tiles
//
////////////////////////////////////////////////////////////////////////////////
function available()
{
    var unused = [];
    
    for (var i = 0; i < 9 ; i++)
    {
        for (var j = 0; j < 9 ; j++)
        {
            if (player[i][j][0] == null)
            {
                unused[unused.length] = [i,j];
            }
        }
    }
    
    return unused;
}
////////////////////////////////////////////////////////////////////////////////
//
// ?Sudoku player?
//
////////////////////////////////////////////////////////////////////////////////
function sudokuPlayer()
{
    player = [];

    for (var i = 0; i < 9 ; i++)
    {
        player[i] = [];
        
        for (var j = 0; j < 9 ; j++)
        {
            player[i][j] = [null,false];
        }
    }
    
    for (var i = 0; i < 9; i++)
    {
        for (var j = 0; j < 9; j++)
        {
            for (var k = i + 1; k < 9; k++)
            {
                for (var l = j + 1; l < 9; l++)
                {
                    if ((board[i][l] == board[k][j]) && (board[i][j] == board[k][l]))
                    {
                        var ranNum = Math.floor(Math.random()*4+1);
                        var col;
                        var row;
                        switch (ranNum)
                        {
                            case 1 : col = i; row = l; break;
                            case 2 : col = k; row = j; break;
                            case 3 : col = i; row = j; break;
                            case 4 : col = k; row = l; break;			
                        }	
                        if (player[col][row][0] == null)
                        {
                            player[col][row][0] = board[col][row];
                            player[col][row][1] = true;
                        }
                    }
                }
            }
        }
    }
    
    var hintLevel = difficulty[3];
    
    for (var i = 0; i < hintLevel.length; i++)
    {
        var unused = [];
            
        for (var j = (matrix[i][0] * 3); j < ((matrix[i][0] + 1) * 3); j++)
        {
            for (var k = (matrix[i][1] * 3); k < ((matrix[i][1] + 1) * 3); k++)
            {
                if (player[j][k][0] == null)
                {
                    unused[unused.length] = [j,k];
                }
            }
        }

        do
        {
            var l = Math.floor(Math.random()*unused.length);

            if (player[unused[l][0]][unused[l][1]][0] == null)
            {
                player[unused[l][0]][unused[l][1]][0] = board[unused[l][0]][unused[l][1]];
                player[unused[l][0]][unused[l][1]][1] = true;
                    
                unused.splice(l, 1);
            }
        }
        while (unused.length > (7 - (difficulty[level][i] - hintLevel[i])));
    }
    
    return true;
}
////////////////////////////////////////////////////////////////////////////////
//
// Validate hints
//
////////////////////////////////////////////////////////////////////////////////
function validHint(valid, numbers)
{
    var hints = [];
    
    for (var i = 0; i < valid.length; i++)
    {
        if (numbers[valid[i]] != null)
        {
            hints[hints.length] = valid[i];
        }
    }
    
    return hints;
}
////////////////////////////////////////////////////////////////////////////////
//
// Create Sudoku board
//
////////////////////////////////////////////////////////////////////////////////
function sudokuBoard()
{
    board = [];

    for (var i = 0; i < 9 ; i++)
    {
        board[i] = [];
        
        for (var j = 0; j < 9 ; j++)
        {
            board[i][j] = null;
        }
    }

    for (var i = 0; i < 3 ; i++)
    {
        for (var j = 0; j < 3 ; j++)
        {
            var valid = gridFill(j, i);

            if (!valid)
            {
                return false;
            }
        }
    }

}
////////////////////////////////////////////////////////////////////////////////
//
// Assign numbers to a specified 3x3 grid
//
////////////////////////////////////////////////////////////////////////////////
function gridFill(intX, intY)
{
    var rows = [];
    var cols = [];
    var grid = gridBits(intX, intY);
    
    for (var i = (intY * 3); i < ((intY + 1) * 3); i++)
    {
        for (var j = (intX * 3); j < ((intX + 1) * 3); j++)
        {
            if (board[i][j] == null)
            {
                if (rows[i] == null)
                {
                    rows[i] = rowBits(i);
                }
                
                if (cols[j] == null)
                {
                    cols[j] = columnBits(j);
                }
                
                var num = validNumber(grid | rows[i] | cols[j]);

                if (num != -1)
                {
                    grid |= (1<<num);
                    rows[intY] |= (1<<num);
                    cols[intX] |= (1<<num);
                    
                    board[i][j] = num;
                }
                else
                {
                    return false;
                }
            }
        }
    }
    
    return true;
}
////////////////////////////////////////////////////////////////////////////////
//
// Grid bits
//
////////////////////////////////////////////////////////////////////////////////
function gridBits(intX, intY)
{
    var bit = 0;
    
    for (var i = (intY * 3); i < ((intY + 1) * 3); i++)
    {
        for (var j = (intX * 3); j < ((intX + 1) * 3); j++)
        {
            if (board[i][j] != null)
            {
                bit |= (1<<board[i][j]);
            }
        }
    }
    
    return bit;
}
////////////////////////////////////////////////////////////////////////////////
//
// Keep track of row numbers
//
////////////////////////////////////////////////////////////////////////////////
function rowBits(intY)
{
    var bit = 0;
    
    for (var i = 0; i < 9; i++)
    {
        if (board[intY][i] != null)
        {
            bit |= (1<<board[intY][i]);
        }
    }
    
    return bit;
}
////////////////////////////////////////////////////////////////////////////////
//
// Keep track of column numbers
//
////////////////////////////////////////////////////////////////////////////////
function columnBits(intX)
{
    var bit = 0;
    
    for (var i = 0; i < 9; i++)
    {
        if (board[i][intX] != null)
        {
            bit |= (1<<board[i][intX]);
        }
    }
    
    return bit;
}
////////////////////////////////////////////////////////////////////////////////
//
// Get valid numbers
//
////////////////////////////////////////////////////////////////////////////////
function validNumber(bits)
{
    if (bits == bitFull)
    {
        return -1;
    }

    var valid = "";
    
    for (var i = 1; i <= 9; i++)
    {
        if (!(bits & (1<<i)))
        {
            valid += i;
        }
    }

    return parseInt(valid.charAt(Math.floor(Math.random()*valid.length)));
}
////////////////////////////////////////////////////////////////////////////////
//
// Highlight tile on mouseover
//
////////////////////////////////////////////////////////////////////////////////
function highlight(enable, intX, intY)
{
    if (!end && !player[intY][intX][1] && g_board.keypad.click == null)
    {
        enableBorder(enable, intX, intY);
        
        if (enable)
        {
            g_board.keypad.hover = {x:intX,y:intY};
        }
        else
        {
            g_board.keypad.hover = null;
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Select tile
//
////////////////////////////////////////////////////////////////////////////////
function select(intX, intY)
{
    if (!end)
    {
        if (g_board.keypad.click != null)
        {
            enableBorder(false, g_board.keypad.click.x, g_board.keypad.click.y);
        }
        
        g_board.keypad.hover = null;
        g_board.keypad.click = {x:intX,y:intY};
        
        enableBorder(true, g_board.keypad.click.x, g_board.keypad.click.y);
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// Display tile border
//
////////////////////////////////////////////////////////////////////////////////
function enableBorder(enable, intX, intY)
{
    with (document.getElementById("square_" + intY + "_" + intX).style)
    {
        paddingTop = (enable ? 0 : g_board.text.padding) + "px";
        border = (enable ? "solid " + g_board.text.border + "px #000000" : "");
    }
}
