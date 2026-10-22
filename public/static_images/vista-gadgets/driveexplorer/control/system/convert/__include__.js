////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Convert =
{
    GetTypeCode: function(/*Object*/ obj)
    {
        // summary:
        //   Returns the TypeCode for the specified object.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Boolean
        
        return __System.Type.GetTypeCode(obj);
    },
    IsDBNull: function(/*Object*/ obj)
    {
        // summary:
        //   Returns an indication whether the specified object is
        //   of type DBNull.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Boolean
        
        return (__System.Type.GetTypeCode(obj) == __System.TypeCode.DBNull);
    },
    ToBoolean: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to an equivalent Boolean value.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Boolean
        
        if (typeof obj == "string" && (obj == "true" || obj == "false"))
        {
            return (obj == "true");
        }
        
        return (obj ? true : false);
    },
    ToByte: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to an 8-bit unsigned integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (__System.Type._IsBoolean(n))
        {
            return (obj ? 1 : 0);
        }
        else if ((__System.Type._IsString(n) || __System.Type._IsObject(n)) && !__System.Type._IsEmpty(n))
        {
            return (!isNaN(parseInt(obj.toString())) ? Math.min(Math.max(0, parseInt(obj.toString())), 255) : null);
        }
        else if (__System.Type._IsNumber(n))
        {
            return Math.min(Math.max(0, obj), 255);
        }
        
        return null;
    },
    ToChar: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a Unicode character.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Unicode Char
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            obj = obj.toString().replace(/^\s+/, "").replace(/\s+/g, " ");
            
            if (obj.length > 0)
            {
                var s = "";
                var o = obj.split(" ");
                
                for (var i = 0; i < o.length; i++ )
                {
                    var n = parseInt(o[i], 16);
                    
                    if (n <= 0xFFFF)
                    {
                        s += String.fromCharCode(n);
                    }
                    else if (n <= 0x10FFFF)
                    {
                        n -= 0x10000;
                        s += String.fromCharCode(0xD800 | (n >> 10)) + String.fromCharCode(0xDC00 | (n & 0x3FF));
                    }
                    else
                    {
                        return null;
                    }
                }
                
                return s;
            }
        }
        
        return null;
    },
    ToDateTime: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a DateTime.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Date
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            try
            {
                return new Date(obj.toString());
            }
            catch (e)
            {
            }
        }
        
        return null;
    },
    ToDecimal: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a Decimal number.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Float
        
        return this.ToDouble(obj);
    },
    ToDouble: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a double-precision
        //   floating point number.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Float
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return parseFloat(obj.toString());
        }
        
        return null;
    },
    ToInt16: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 16-bit signed integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), -32768), 32767);
        }
        
        return null;
    },
    ToInt32: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 32-bit signed integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), -2147483648), 2147483647);
        }
        
        return null;
    },
    ToInt64: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 64-bit signed integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), -9223372036854775808), 9223372036854775807);
        }
        
        return null;
    },
    ToSByte: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to an 8-bit signed integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), -128), 127);
        }
        
        return null;
    },
    ToSingle: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a single-precision
        //   floating point number.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Float
        
        return this.ToDouble(obj);
    },
    ToString: function(/*Object*/ obj)
    {
        // summary:
        //   Converts the specified value to its equivalent
        //   String representation.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Float
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return obj.toString();
        }
        
        return null;
    },
    ToUInt16: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 16-bit unsigned integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), 0), 65535);
        }
        
        return null;
    },
    ToUInt32: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 32-bit unsigned integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), 0), 4294967295);
        }
        
        return null;
    },
    ToUInt64: function(/*Object*/ obj)
    {
        // summary:
        //   Converts a specified value to a 64-bit unsigned integer.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Integer
        
        var n = __System.Type.GetTypeCode(obj)
        
        if (!__System.Type._IsEmpty(n))
        {
            return Math.min(Math.max(parseInt(obj.toString()), 0), 18446744073709551615);
        }
        
        return null;
    },
    _IsNullToDefault: function(/*Object*/ obj, /*Object*/ reference)
    {
        // summary:
        //   Converts a specified value to default value if the value is null.
        //
        // arguments:
        //   obj (required)
        //   reference (required)
        //
        // returns: Object
        
        if (typeof reference != "undefined")
        {
            return (obj != null ? obj : reference);
        }
    }
}

__System.Import("System.Convert", true);
