/**
 * ExpressCalc Copyright 2006 William R. Swanson
 */

/**
 * Updates the value of the input box.
 */
function setInput(text) {
    var input = document.getElementById('input');
    if (input.className == 'prompt') {
        input.value = text;
        input.className = '';
    } else {
        input.value += text;
    }
}

/**
 * Prevents the input prompt from appearing.
 */
var inhibit = false;
function setInhibit() {
    inhibit = true;
}

/**
 * Writes a question/answer pair to the results pane.
 */
function writeResult(question, answer) {
	//Create the question portion:
	var q = document.createElement("p");
	q.className = "question";
	q.appendChild(document.createTextNode(question));
	q.onmousedown = setInhibit;
	q.onclick = function (e) {
	    return setInput('(' + question + ')');
	};

	//Create the answer portion:
	var a = document.createElement("p");
	a.className = "answer";
	a.appendChild(document.createTextNode(answer));
	a.onmousedown = setInhibit;
	a.onclick = function (e) {
	    return setInput(answer);
	};

	//Combine the two:
	var result = document.createElement("div");
	result.appendChild(q);
	result.appendChild(a);

	//Insert the whole thing into the document:
	var results = document.getElementById("results");
	if (results.firstChild) {
		results.insertBefore(result, results.firstChild);
	} else {
		results.appendChild(result);
	}

	//Cull if we have too many:
	if (4 < results.childNodes.length)
		results.removeChild(results.lastChild);
}

/**
 * Evaluates a mathematical expression.
 */
function getAnswer(question) {
    var pi = Math.PI;
    var e = Math.E;
    var acos = Math.acos;
    var asin = Math.asin;
    var atan = Math.atan;
    var cos = Math.cos;
    var sin = Math.sin;
    var tan = Math.tan;
    var exp = Math.exp;
    var log = Math.log;
    var pow = Math.pow;
    var sqrt = Math.sqrt;

    try {
        var answer = eval(question)
        var fixed = answer.toFixed(9);
        answer = answer.toString();
        if (fixed.length < answer.length)
            return fixed;
        return answer;
    } catch (e) {
        return 'error';
    }
}

/**
 * Hides the prompt and makes the input appear "hot."
 */
function onFocus() {
	var input = document.getElementById('input');
	if (input.className == 'prompt')
	    input.value = '';
    input.className = 'hot';
    inhibit = false;
}

/**
 * Displays the prompt if the input is empty, and removes "hot" visuals.
 */
function onBlur() {
    var input = document.getElementById('input');
    if (input.value || inhibit) {
	    input.className = '';
	} else {
	    input.className = 'prompt';
        input.value = 'Enter an expression';
	}
    inhibit = false;
}

/**
 * Processes form submission.
 */
function onSubmit() {
    var input = document.getElementById('input');
    if (input.value)
	    writeResult(input.value, getAnswer(input.value));
    input.value = '';
	return false;
}

/**
 * Do the initial setup.
 */
function setup() {
    document.getElementById('form').onsubmit = onSubmit;
    document.getElementById('input').onfocus = onFocus;
    document.getElementById('input').onblur = onBlur;
    var input = document.getElementById('input');
    input.value = '';
    onBlur();
}
window.onload = setup;
