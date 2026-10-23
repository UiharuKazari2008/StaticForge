//generic obj
function genericObj() {
}
root = this;
//tweener obj
function tweener(div) {
	root['callback_'+div] = this;
	this.crap = function(msg) {
		alert(msg);
	};
	this.foobar='yeeee'
	this.div = div;
	this.pos_x_data = new genericObj();
	this.pos_y_data = new genericObj();
	this.alpha_data = new genericObj();
	this.original_left=parseInt(document.getElementById(this.div).style.left)
	this.original_top=parseInt(document.getElementById(this.div).style.top)
	//tween initiator method - X
	this.tweenPosX = function(finish, duration, easing,closing_func) {
		clearInterval(this.pos_x_data.interval_no);
		this.myReference = (document.getElementById(this.div).style);
		//this.myReference.filter="alpha(opacity=100)"						
		this.pos_x_data.t = 0;
		this.pos_x_data.refPosLeft = parseInt(this.myReference.left);
		this.pos_x_data.refPosTop = parseInt(this.myReference.top);
		//this.refPosLeft=parseInt(this.myReference.left)
		//this.refPosTop=parseInt(this.myReference.top)
		this.pos_x_data.closing_func=closing_func
		this.pos_x_data.easing = easing;
		this.pos_x_data.start = this.pos_x_data.refPosLeft;
		this.pos_x_data.finish = finish-this.pos_x_data.start;
		this.pos_x_data.duration = duration*fps;
		root['callback_pos_'+this.div] = this;
		this.pos_x_data.interval_id = setInterval('startTweenPosX(root.'+'callback_pos_'+this.div+','+'"'+this.div+'"'+','+this.pos_x_data.start+','+this.pos_x_data.finish+','+this.pos_x_data.duration+','+'"'+this.pos_x_data.easing+'"'+')', 1000/fps);
		this.pos_x_data.interval_no = this.pos_x_data.interval_id;
	};
	//tween initiator method - Y
	this.tweenPosY = function(finish, duration, easing,closing_func) {
		clearInterval(this.pos_y_data.interval_no);
		this.myReference = (document.getElementById(this.div).style);
		//this.myReference.filter="alpha(opacity=100)"						
		this.pos_y_data.t = 0;
		this.pos_y_data.refPosLeft = parseInt(this.myReference.left);
		this.pos_y_data.refPosTop = parseInt(this.myReference.top);
		//this.refPosLeft=parseInt(this.myReference.left)
		//this.refPosTop=parseInt(this.myReference.top)
		this.pos_y_data.closing_func=closing_func
		this.pos_y_data.easing = easing;
		this.pos_y_data.start = this.pos_y_data.refPosTop;
		this.pos_y_data.finish = finish-this.pos_y_data.start;
		this.pos_y_data.duration = duration*fps;
		root['callback_pos_'+this.div] = this;
		this.pos_y_data.interval_id = setInterval('startTweenPosY(root.'+'callback_pos_'+this.div+','+'"'+this.div+'"'+','+this.pos_y_data.start+','+this.pos_y_data.finish+','+this.pos_y_data.duration+','+'"'+this.pos_y_data.easing+'"'+')', 1000/fps);
		this.pos_y_data.interval_no = this.pos_y_data.interval_id;
	};
	//alpha tweener initiator
	this.tweenAlpha = function(finish, duration, easing,closing_func) {					
			clearInterval(this.alpha_data.interval_no);
			this.alpha_data.t=0
			this.myReference = (document.getElementById(this.div).style);
			if (this.myReference.filter == '') {
				this.alpha_data.start = 100;
				this.myReference.filter = "alpha(opacity="+this.alpha_data.start+")";
				
			} else {
				//extract the opacity value
				var filter_str = this.myReference.filter;
				var i0 = filter_str.indexOf('opacity=');
				filter_str = filter_str.slice(i0);
				filter_str = (filter_str.slice(8));
				var i0 = filter_str.indexOf(')');
				this.alpha_data.start = parseInt(filter_str.slice(0, i0));
			}
			this.alpha_data.closing_func=closing_func
			this.alpha_data.finish = finish-this.alpha_data.start;
			this.alpha_data.easing = easing;
			this.alpha_data.duration = duration*fps;			
			root['callback_alpha_'+this.div] = this;			
			this.alpha_data.interval_id = setInterval('startTweenAlpha(root.'+'callback_alpha_'+this.div+','+'"'+this.div+'"'+','+this.alpha_data.start+','+this.alpha_data.finish+','+this.alpha_data.duration+','+'"'+this.alpha_data.easing+'"'+')', 1000/fps);
			this.alpha_data.interval_no = this.alpha_data.interval_id 
		}
	
}
//renderers
shiftDiv = function (dir, div, pos) {
	myReference = (document.getElementById(div).style);
	if (dir == 'x') {
		current_pos = myReference.left;
		myReference.left = pos+'px';
	} else if (dir == 'y') {
		current_pos = myReference.left;
		myReference.top = pos+'px';
	}
};
startTweenPosX = function (obj, div, start, finish, duration, easing) {
	var new_pos = root[easing](obj.pos_x_data.t, start, finish, duration);
	
	obj.pos_x_data.t += 1;
	shiftDiv('x', div, new_pos);
	if (obj.pos_x_data.t>obj.pos_x_data.duration) {
		clearInterval(obj.pos_x_data.interval_id);
		
		obj.pos_x_data.t = 0;
		if(obj.pos_x_data.closing_func=="rewind"){
			
			root['callback_pos_'+div].tweenPosX(root['callback_pos_'+div].original_left,.3,"ElasticEaseOut")
			//eval(obj.pos_y_data.closing_func)
		}
	}
};
startTweenPosY = function (obj, div, start, finish, duration, easing) {
	var new_pos = root[easing](obj.pos_y_data.t, start, finish, duration);
	obj.pos_y_data.t += 1;
	shiftDiv("y", div, new_pos);
	if (obj.pos_y_data.t>obj.pos_y_data.duration) {
		clearInterval(obj.pos_y_data.interval_id);		
		obj.pos_y_data.t = 0;
		if(obj.pos_y_data.closing_func=="rewind"){
			
			root['callback_pos_'+div].tweenPosY(root['callback_pos_'+div].original_top,.3,"ElasticEaseOut")
			//eval(obj.pos_y_data.closing_func)
		}
	}
};
startTweenAlpha = function (obj, div, start, finish, duration, easing) {	
	
	var new_val = root[easing](obj.alpha_data.t, start, finish, duration);	
	obj.alpha_data.t += 1;
	obj.myReference.filter = "alpha(opacity="+new_val+")";
	if (obj.alpha_data.t>obj.alpha_data.duration) {			
		obj.alpha_data.finished_tween = true;
		clearInterval(obj.alpha_data.interval_id);
		if(obj.alpha_data.closing_func){
			eval(obj.alpha_data.closing_func)
		}
		obj.alpha_data.t = 0;
	}
	
};
