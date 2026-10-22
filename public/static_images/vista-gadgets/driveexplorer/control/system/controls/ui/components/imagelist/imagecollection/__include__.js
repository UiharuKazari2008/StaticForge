////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.ImageList.ImageCollection = function()
{
    var __key = [];
    var __ordered = [];
    var __orderedKeyIndex = [];
    var __unordered = [];
    var __this = this;
    
    this.Count = 0;
    this.Empty = false;
    this.Keys = [];
    
    function ___FindKeyIndex(/*Object*/ key)
    {
        // summary:
        //   Internal procedure to find the index of a key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Integer
        
        for (var i = 0; i < __orderedKeyIndex.length; i++)
        {
            if (__orderedKeyIndex[i] == key)
            {
                return i;
            }
        }
        
        return -1;
    }
    
    function ___Properties(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Internal procedure to create data access features.
        //
        // arguments:
        //   index (optional)
        //   count (optional)
        //
        // returns: Nothing
        
        var n = __this.Count;
        
        __this.Count = __ordered.length;
        
        count = (count != null ? Math.min(index + count, this.Count) : __this.Count);
        
        for (var i = (index != null ? index : 0); i < count; i++)
        {
            __this[i] = __ordered[i];
            __this.Item[i] =
            {
                index: i,
                get: function()
                {
                    return __ordered[this.index];
                },
                set: function(/*Object*/ value)
                {
                    __ordered[this.index] = value;
                    
                    if (__orderedKeyIndex[this.index] != null)
                    {
                        __unordered[__orderedKeyIndex[this.index]] = value;
                    }
                }
            }
        }
        
        for (var i = __this.Count; i < n; i++)
        {
            delete __this[i];
            delete __this.Item[i];
        }
        
        __this.Keys = [];
        
        for (var i = 0; i < __key.length; i++)
        {
            __this.Keys[i] = __key[i];
        }
        
        __this.Empty = (__this.Count > 0 || __key.length > 0);
    }
    
    function ___RemoveKey(/*Object*/ key)
    {
        // summary:
        //   Internal procedure to remove a key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Nothing
        
        var n = -1;
        
        for (var i = 0; i < __key.length; i++)
        {
            if (__key[i] == key)
            {
                __key.splice(n, 1);
                break;
            }
        }
        
        delete __unordered[key];
    }
    
    ___Properties();
    
    this.Enumerator = function()
    {
        // summary:
        //   Enumerates the elements of a ImageCollection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        this.Count = __this.Count;
        this.Current = -1;
        
        this.MoveNext = function()
        {
            if (this.Current < this.Count - 1)
            {
                this.Current++;
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
    
    this.Add = function(/*Object*/ item)
    {
        // summary:
        //   Adds the specified object to the ImageList.
        //
        // arguments:
        //   item (required)
        //
        // returns: Nothing
        
        if (typeof item != "undefined")
        {
            __ordered.push(item);
            __orderedKeyIndex.push(null);
            
            ___Properties();
        }
    }
    
    this.AddRange = function(/*Array*/ collection)
    {
        // summary:
        //   Adds an array of images to the collection.
        //
        // arguments:
        //   collection (required)
        //
        // returns: Nothing
        
        if (collection != null)
        {
            var b = true;
            
            if (collection.splice != null || collection.Enumerator != null)
            {
                b = false;
                
                var images = [];
                
                if (collection.Enumerator != null)
                {
                    try
                    {
                        var o = collection.GetEnumerator();
                        
                        while (o.MoveNext())
                        {
                            images.push(o.Item[o.Current].get());
                        }
                    }
                    catch (e)
                    {
                        b = true;
                    }
                }
                else
                {
                    images = collection;
                }
                
                if (!b)
                {
                    for (var i = 0; i < images.length; i++)
                    {
                        this.Add(images[i]);
                    }
                }
            }
            
            if (b)
            {
                this.Add(collection);
            }
        }
    }
    
    this.Clear = function()
    {
        // summary:
        //   Removes all the images and masks from the ImageList.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __ordered = [];
        __orderedKeyIndex = [];
        __key = [];
        __unordered = [];
        
        this.Item = {};
        
        ___Properties();
    }
    
    this.Contains = function(/*Object*/ item)
    {
        // summary:
        //   Indicates whether a specified object is contained
        //   in the list.
        //
        // arguments:
        //   item (required)
        //
        // returns: Boolean
        
        if (typeof item != "undefined")
        {
            return (this.IndexOf(item) != -1);
        }
        
        return false;
    }
    
    this.ContainsKey = function(/*Object*/ key)
    {
        // summary:
        //   Determines if the collection contains an image with
        //   the specified key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Boolean
        
        if (typeof key != "undefined")
        {
            return (typeof __unordered[key] != "undefined");
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
        
        if (obj0.Count == obj1.Count && obj0.Keys.length == obj1.Keys.length)
        {
            for (var i = 0; i < obj0.Count; i++)
            {
                if (obj0[i] != obj1[i] || typeof obj0[i] != typeof obj1[i])
                {
                    return false;
                }
            }
            
            for (var i = 0; i < obj0.Keys.length; i++)
            {
                if (obj0.Keys[i] != obj1.Keys[i] || typeof obj0.Keys[i] != typeof obj1.Keys[i])
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
        //   Returns an enumerator that can be used to iterate
        //   through the item collection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.IndexOf = function(/*Object*/ item, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Returns the index of a specified object in the list.
        //
        // arguments:
        //   item (required)
        //   index (optional)
        //   count (optional)
        //
        // returns: Integer
        
        if (typeof item != "undefined")
        {
            index = (index != null ? parseInt(index) : 0);
            var end = this.Count;
            
            if (index < 0 || index > this.Count - 1)
            {
                return -1;
            }
            
            if (count != null)
            {
                count = parseInt(count);
                
                if (count < 0)
                {
                    return -1;
                }
                
                end = Math.min(index + count, this.Count);
            }
            
            for (var i = index; i < end; i++)
            {
                if (__ordered[i] == item && typeof __ordered[i] == typeof item)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    this.IndexOfKey = function(/*Object*/ key)
    {
        // summary:
        //   Returns the index of a specified object in the list.
        //
        // arguments:
        //   key (required)
        //
        // returns: Integer
        
        if (typeof key != "undefined")
        {
            for (var i = 0; i < this.Count; i++)
            {
                if (__orderedKeyIndex[i] == key && typeof __orderedKeyIndex[i] == typeof key)
                {
                    return i;
                }
            }
        }
        
        return -1;
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
    
    this.Remove = function(/*Object*/ item)
    {
        // summary:
        //   Removes a specified object from the list. 
        //
        // arguments:
        //   item (required)
        //
        // returns: Nothing
        
        if (typeof item != "undefined")
        {
            var n = this.IndexOf(item);
            
            if (n != -1)
            {
                this.RemoveAt(n);
            }
        }
    }
    
    this.RemoveAt = function(/*Integer*/ index)
    {
        // summary:
        //   Removes an image from the list.
        //
        // arguments:
        //   index (required)
        //
        // returns: Nothing
        
        if (index != null)
        {
            if (index >= 0 && index < this.Count)
            {
                if (__orderedKeyIndex[index] != null)
                {
                    this.RemoveByKey(__orderedKeyIndex[index]); 
                }
                else
                {
                    __ordered.splice(index, 1);
                }
                
                ___Properties(index);
            }
        }
    }
    
    this.RemoveByKey = function(/*String*/ key)
    {
        // summary:
        //   Removes the image with the specified key from the collection.
        //
        // arguments:
        //   key (required)
        //
        // returns: Nothing
        
        if (key != null)
        {
            if (this.ContainsKey(key))
            {
                ___RemoveKey(key);
                
                var n = ___FindKeyIndex(key);
                
                if (n != -1)
                {
                    this.RemoveAt(n);
                }
            }
        }
    }
    
    this.SetKeyName = function(/*Integer*/ index, /*String*/ key)
    {
        // summary:
        //   Sets the key for an image in the collection.
        //
        // arguments:
        //   index (required)
        //   key (required)
        //
        // returns: Nothing
        
        if (key != null)
        {
            if (typeof key != "number" && parseInt(key).toString() != key.toString() && index >= 0 && index < this.Count)
            {
                if (__orderedKeyIndex[index] != null && __orderedKeyIndex[index] != key)
                {
                    ___RemoveKey(__orderedKeyIndex[index]);
                }
                
                __orderedKeyIndex[index] = key;
                
                if (!this.ContainsKey(key))
                {
                    __key.push(key);
                }
                
                __unordered[key] = __ordered[index];
                
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
        
        return __ordered.toString();
    }
}

if (typeof ImageCollection == "undefined")
{
    ImageCollection = __System.Controls.UI.Components.ImageList.ImageCollection;
}

__System.Import("System.Controls.UI.Components.ImageList.ImageCollection", true);
