//elastic
ElasticEaseIn= function(t, b, c, d, a, p) {
	if (t==0) return b;  if ((t/=d)==1) return b+c;  if (!p) p=d*.3;
		if (!a || a < Math.abs(c)) { a=c; var s=p/4; }
		else var s = p/(2*Math.PI) * Math.asin (c/a);
		return -(a*Math.pow(2,10*(t-=1)) * Math.sin( (t*d-s)*(2*Math.PI)/p )) + b;
}
ElasticEaseOut= function(t, b, c, d, a, p) {
	if (t==0) return b;  if ((t/=d)==1) return b+c;  if (!p) p=d*.4;
		if (!a || a < Math.abs(c)) { a=c; var s=p/4; }
		else var s = p/(2*Math.PI) * Math.asin (c/a);
		return (a*Math.pow(2,-10*t) * Math.sin( (t*d-s)*(2*Math.PI)/p ) + c + b);

}
ElasticEaseInOut= function(t, b, c, d, a, p) {
	if (t==0) return b;  if ((t/=d/2)==2) return b+c;  if (!p) p=d*(.3*1.5);
		if (!a || a < Math.abs(c)) { a=c; var s=p/4; }
		else var s = p/(2*Math.PI) * Math.asin (c/a);
		if (t < 1) return -.5*(a*Math.pow(2,10*(t-=1)) * Math.sin( (t*d-s)*(2*Math.PI)/p )) + b;
		return a*Math.pow(2,-10*(t-=1)) * Math.sin( (t*d-s)*(2*Math.PI)/p )*.5 + c + b;

}
//back
BackEaseIn = function (t, b, c, d) {
	s = 1.8;
	return c*(t /= d)*t*((s+1)*t-s)+b;
};
BackEaseOut = function (t, b, c, d) {
	s = 1.8;
	return c*((t=t/d-1)*t*((s+1)*t+s)+1)+b;
};
BackEaseInOut = function (t, b, c, d) {
	s = 1.70158;
	if ((t /= d/2)<1) {
		return c/2*(t*t*(((s *= (1.525))+1)*t-s))+b;
	}
	return c/2*((t -= 2)*t*(((s *= (1.525))+1)*t+s)+2)+b;
};
//strong
StrongEaseIn = function (t, b, c, d) {
	return c*(t /= d)*t*t*t*t+b;
};
StrongEaseOut = function (t, b, c, d) {
	return c*((t=t/d-1)*t*t*t*t+1)+b;
};
StrongEaseInOut = function (t, b, c, d) {
	if ((t /= d/2)<1) {
		return c/2*t*t*t*t*t+b;
	}
	return c/2*((t -= 2)*t*t*t*t+2)+b;
};
//quad
QuadEaseIn = function (t, b, c, d) {
	return c*(t /= d)*t+b;
};
QuadEaseOut = function (t, b, c, d) {
	return -c*(t /= d)*(t-2)+b;
};
QuadEaseInOut = function (t, b, c, d) {
	if ((t /= d/2)<1) {
		return c/2*t*t+b;
	}
	return -c/2*((--t)*(t-2)-1)+b;
};
//bounce
BounceEaseOut = function (t, b, c, d) {
	if ((t /= d)<(1/2.75)) {
		return c*(7.5625*t*t)+b;
	} else if (t<(2/2.75)) {
		return c*(7.5625*(t -= (1.5/2.75))*t+.75)+b;
	} else if (t<(2.5/2.75)) {
		return c*(7.5625*(t -= (2.25/2.75))*t+.9375)+b;
	} else {
		return c*(7.5625*(t -= (2.625/2.75))*t+.984375)+b;
	}
};
BounceEaseIn = function (t, b, c, d) {
	return c-BounceEaseOut(d-t, 0, c, d)+b;
};
BounceEaseInOut = function (t, b, c, d) {
	if (t<d/2) {
		return BounceEaseIn(t*2, 0, c, d)*.5+b;
	} else {
		return BounceEaseOut(t*2-d, 0, c, d)*.5+c*.5+b;
	}
};
