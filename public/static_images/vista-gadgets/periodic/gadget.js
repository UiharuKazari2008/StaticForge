// ------------------------------
// Periodic Table Gadget
// by Matt Sharpe
// www.mdsharpe.com
//
// Portions based on MSDN Ticker by LiveGadgets.net

var anDiv;
var symbolDiv;
var nameDiv;
var ramDiv;
var linkElement;
var flyoutDocument;
var elements;
var selectedElementIndex = 0;
var tableWidth = 18;
var tableHeight = 10;
var elementIsSelected = false;

// called when the gadget loads
function pageLoad() {
    window.detachEvent("onload", pageLoad);
    window.attachEvent("onunload", pageUnload);

    var el, gadgetEl;

    //setup the flyout stuff
    System.Gadget.Flyout.onShow = onFlyoutShow;
    System.Gadget.Flyout.onHide = onFlyoutHide;
    System.Gadget.Flyout.file = "flyout.html";

    gadgetEl = document.getElementById("gadget"); //get the container

    //dynamically create our content
    anDiv = document.createElement("div");
    anDiv.className = "anDiv";
    gadgetEl.appendChild(anDiv);
    symbolDiv = document.createElement("div");
    symbolDiv.className = "symbolDiv";
    gadgetEl.appendChild(symbolDiv);
    nameDiv = document.createElement("div");
    nameDiv.className = "nameDiv";
    gadgetEl.appendChild(nameDiv);
    ramDiv = document.createElement("div");
    ramDiv.className = "ramDiv";
    gadgetEl.appendChild(ramDiv);

    linkElement = document.createElement("div");
    linkElement.className = "linkDiv";
    var imagePath = System.Gadget.path + "\\showTable.png";
    linkElement.innerHTML = "<img src=\"" + imagePath + "\" />";
    linkElement.attachEvent('onclick', handleClick);
    gadgetEl.appendChild(linkElement);
    System.Gadget.background = "background.png";


    getTableData(); //start loading the RSS feed
    updateDisplay();
    el = gadgetEl = null;
}

function getTableData() {
    //shut down feed timer (if running)

    var xdoc = new ActiveXObject("Microsoft.XMLDOM");

    xdoc.onreadystatechange = function() {
        if (xdoc.readyState == 4) {
            onXmlReturnHandler(xdoc);
        }
    };
    var xmlPath = System.Gadget.path + "\\Elements.xml";
    xdoc.load(xmlPath);

    var nodes;

    try {
        nodes = xdoc.getElementsByTagName("element");
        elements = new Array(nodes.length);
        for (i = 0; i < nodes.length; i++) {
            elements[i] = new Object();
            elements[i].atomicNumber = nodes[i].selectSingleNode('atomicNumber').text;
            elements[i].symbol = nodes[i].selectSingleNode('symbol').text;
            elements[i].name = nodes[i].selectSingleNode('name').text;
            elements[i].ram = nodes[i].selectSingleNode('ram').text;
            elements[i].tableX = nodes[i].selectSingleNode('tableX').text;
            elements[i].tableY = nodes[i].selectSingleNode('tableY').text;
            elements[i].wikipediaLink = nodes[i].selectSingleNode('wikipediaLink').text;
        }
    } catch (ex) { }
    node = nodes = xdoc = null;
}

function updateDisplay() {
    if (elementIsSelected) {
        if (elements.length > 0) {
            anDiv.innerHTML = elements[selectedElementIndex].atomicNumber;
            if (elements[selectedElementIndex].wikipediaLink.length > 0) {
                symbolDiv.innerHTML = createLink(elements[selectedElementIndex].wikipediaLink, elements[selectedElementIndex].symbol);
                nameDiv.innerHTML = createLink(elements[selectedElementIndex].wikipediaLink, elements[selectedElementIndex].name);
            } else {
                symbolDiv.innerHTML = elements[selectedElementIndex].symbol;
                nameDiv.innerHTML = elements[selectedElementIndex].name;
            }
            if (0 != elements[selectedElementIndex].ram) {
                ramDiv.innerHTML = elements[selectedElementIndex].ram;
            } else {
                ramDiv.innerHTML = "";
            }
        } else {
            anDiv.innerHTML = "";
            symbolDiv.innerHTML = "Error";
            nameDiv.innerHTML = "Cannot find elements";
            ramDiv.innerHTML = "";
        }
    } else {
        anDiv.innerHTML = "Periodic<br/>Table";
        symbolDiv.innerHTML = "";
        nameDiv.innerHTML = "No Element Selected";
        ramDiv.innerHTML = "";
    }
    textElement.appendChild(span);
}

function createLink(href, text) {
    return "<a href=\"" + href + "\">" + text + "</a>";
}

// called when the gadget unloads
function pageUnload() {
    window.detachEvent("onunload", pageUnload);

    //shut down timers (if running)
    if (feedTimer) {
        clearTimeout(feedTimer);
        feedTimer = null;
    }

    flyoutDocument = textElement = null;
}

function handleClick() {
    if (!System.Gadget.Flyout.show) {
        System.Gadget.Flyout.show = true;
    }
}

function handleTableClick(event) {
    selectedElementIndex = event.srcElement.dataIndex;
    if (-1 != selectedElementIndex) {
        elementIsSelected = true;
    } else {
        elementIsSelected = false;
    }
    updateDisplay();
}

// ------------------------------
// this gets everything started after the DOM is created
window.attachEvent("onload", pageLoad);

// flyout stuff

// called when a flyout is shown
function onFlyoutShow() {
    var tableDiv;
    var table;
    var tableBody;
    var tableRow;
    var tableCell;
    var htmlString;
    flyoutDocument = System.Gadget.Flyout.document;
    tableDiv = flyoutDocument.getElementById("tableDiv");
    table = flyoutDocument.createElement("table");
    table.style.width = '576px';
    table.style.height = '324px';
    tableBody = flyoutDocument.createElement("tbody");
    for (y = 0; y < tableHeight; y++) {
        tableRow = flyoutDocument.createElement("tr");
        for (x = 0; x < tableWidth; x++) {
            tableCell = flyoutDocument.createElement("td");
            tableCell.className = "elementCell";
            tableCell.style.width = '32px';
            var elementFound = false;
            for (i = 0; i < elements.length; i++) {
                if (elements[i].tableY == y && elements[i].tableX == x) {
                    tableCell.innerHTML = "<span class=\"an\" dataIndex=\"" + i + "\">" + elements[i].atomicNumber
                                          + "</span><br/><span class=\"sy\" dataIndex=\"" + i + "\">" + elements[i].symbol
                                          + "</span>";
                    tableCell.dataIndex = i;
                    elementFound = true;
                    break;
                }
            }
            if (elementFound == false) {
                tableCell.innerHTML = "&nbsp;";
                tableCell.dataIndex = -1;
            }
            tableCell.attachEvent('onclick', handleTableClick);
            tableRow.appendChild(tableCell);
        }
        tableBody.appendChild(tableRow);
    }
    table.appendChild(tableBody);
    tableDiv.appendChild(table);
    tableDiv = null;
}

// called when a flyout is hidden
function onFlyoutHide() {
    flyoutDocument = item = null;
    clearHover();
}