////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Collections.Generic.Dictionary = function()
{
    var __key = [];
    var __unordered = [];
    var __value = [];
    var __this = this;
    
    this.Count = 0;
    this.Keys = [];
    this.Values = [];
    
    function ___FindKeyIndex(/*Object*/ key)
    {
        // summary:
        //   Internal procedure to find the index of a key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Integer
            
        for (var i = 0; i < __key.length; i++)
        {
            if (__key[i] == key)
            {
                return i;
            }
        }
        
        return -1;
    }
    
    function ___Properties()
    {
        // summary:
        //   Internal procedure to create data access features.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __this.Keys = [];
        
        for (var i = 0; i < __key.length; i++)
        {
            __this.Keys[i] = __key[i];
        }
        
        __this.Values = [];
        
        for (var i = 0; i < __value.length; i++)
        {
            __this.Values[i] = __value[i];
        }
        
        __this.Count = __key.length;
    }
    
    this.Enumerator = function()
    {
        // summary:
        //   Enumerates the elements of a Dictionary.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        this.Entry = null;
        this.Key = null;
        this.Value = null;
        
        this.Count = __this.Count;
        this.Current = -1;
        
        this.MoveNext = function()
        {
            if (this.Current < this.Count - 1)
            {
                this.Current++;
                
                this.Key = __this.Keys[this.Current];
                this.Value = __this.Values[this.Current];
                this.Entry = __unordered[this.Key];
                
                return true;
            }
            
            return false;
        }
        
        this.Reset = function()
        {
            this.Current = -1;
        }
    }
    
    this.Item = {
    
    }
    
    this.Add = function(/*Object*/ key, /*Object*/ value)
    {
        // summary:
        //   Adds the specified key and value to the dictionary.
        //
        // arguments:
        //   key (required)
        //   value (required)
        //
        // returns: Nothing
        
        if (!this.ContainsKey(key))
        {
            __key.push(key);
            __value.push(value);
        }
        else
        {
            var n = ___FindKeyIndex(key);
            
            if (n != -1)
            {
                __value[n] = value;
            }
        }
        
        __unordered[key] = value;
        this.Item[key] =
        {
            get: function()
            {
                return __unordered[key];
            },
            set: function(/*Object*/ value)
            {
                __unordered[key] = value;
            }
        }
        
        ___Properties();
    }
    
    this.Clear = function()
    {
        // summary:
        //   Removes all keys and values from the Dictionary.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __key = [];
        __value = [];
        __unordered = [];
        this.Item = {};
        
        ___Properties();
    }
    
    this.ContainsKey = function(/*Object*/ key)
    {
        // summary:
        //   Determines whether the Dictionary contains the specified key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Boolean
        
        return (__unordered[key] != null);
    }
    
    this.ContainsValue = function(/*Object*/ value)
    {
        // summary:
        //   Determines whether the Dictionary contains a specific value.
        //
        // arguments:
        //   value (required)
        //
        // returns: Boolean
        
        for (var i = 0; i < __value.length; i++)
        {
            if (__value[i] == value)
            {
                return true;
            }
        }
        
        return false;
    }
    
    this.Equals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether two Object instances are equal.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (optional)
        //
        // returns: Boolean
        
        obj1 = (obj1 != null ? obj1 : this);
        
        if (obj0.Count == obj1.Count)
        {
            for (var i = 0; i < obj0.Count; i++)
            {
                if (obj0.__key[i] != obj1.__key[i] || typeof obj0.__key[i] != typeof obj1.__key[i] || obj0.__value[i] != obj1.__value[i] || typeof obj0.__value[i] != typeof obj1.__value[i])
                {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
    
    this.GetEnumerator = function()
    {
        // summary:
        //   Returns an enumerator that iterates through the Dictionary.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.ReferenceEquals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether the specified Object instances
        //   are the same instance.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (required)
        //
        // returns: Boolean
        
        return __System.Object.ReferenceEquals(obj0, (obj1 != null ? obj1 : this));
    }
    
    this.Remove = function(/*Object*/ key)
    {
        // summary:
        //   Removes the value with the specified key from the Dictionary.
        //
        // arguments:
        //   key (required)
        //
        // returns: Nothing
        
        if (this.ContainsKey(key))
        {
            var n = ___FindKeyIndex(key);
            
            if (n != -1)
            {
                __key.splice(n, 1);
                __value.splice(n, 1);
                this.Count = __key.length;
                
                __unordered[key] = null;
                this.Item[key] = null;
                
                ___Properties();
            }
        }
    }
    
    this.ToString = function()
    {
        // summary:
        //   Returns a String that represents the current Object.
        //
        // arguments:
        //   none
        //
        // returns: String
        
        return __unordered.toString();
    }
    
    this.TryGetValue = function(/*Object*/ key, /*Object*/ value)
    {
        // summary:
        //   Gets the value associated with the specified key.
        //
        // arguments:
        //   key (required)
        //   value (required)
        //
        // returns: Boolean
        
        if (this.ContainsKey(key))
        {
            value = __unordered[key];
            return true;
        }
        
        return false;
    }
}

__System.Import("System.Collections.Generic.Dictionary", true);
