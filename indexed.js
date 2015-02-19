(function(window) {
    var debug = false;
    var indexedDB            = window.IndexedDB            || window.mozIndexedDB            || window.webkitIndexedDB;
    var IDBCursor            = window.IDBCursor            || window.mozIDBCursor            || window.webkitIDBCursor;
    var IDBDatabase          = window.IDBDatabase          || window.mozIDBDatabase          || window.webkitIDBDatabase;
    var IDBDatabaseError     = window.IDBDatabaseError     || window.mozIDBDatabaseError     || window.webkitIDBDatabaseError;
    var IDBDatabaseException = window.IDBDatabaseException || window.mozIDBDatabaseException || window.webkitIDBDatabaseException;
    var IDBErrorEvent        = window.IDBErrorEvent        || window.mozIDBErrorEvent        || window.webkitIDBErrorEvent;
    var IDBEvent             = window.IDBEvent             || window.mozIDBEvent             || window.webkitIDBEvent;
    var IDBFactory           = window.IDBFactory           || window.mozIDBFactory           || window.webkitIDBFactory;
    var IDBIndex             = window.IDBIndex             || window.mozIDBIndex             || window.webkitIDBIndex;
    var IDBKeyRange          = window.IDBKeyRange          || window.mozIDBKeyRange          || window.webkitIDBKeyRange;
    var IDBObjectStore       = window.IDBObjectStore       || window.mozIDBObjectStore       || window.webkitIDBObjectStore;
    var IDBRequest           = window.IDBRequest           || window.mozIDBRequest           || window.webkitIDBRequest;
    var IDBSuccessEvent      = window.IDBSuccessEvent      || window.mozIDBSuccessEvent      || window.webkitIDBSuccessEvent;
    var IDBTransaction       = window.IDBTransaction       || window.mozIDBTransaction       || window.webkitIDBTransaction;
    var stores = {};

    //Basic class for interfacing with the indexedDB
    function DBObject(db) {
        this.db = db;
        this.onsuccesses = [];
        this.onerrors = [];
        this.lastError = null;
        this.stores = {};
    }
    DBObject.prototype._init = function(db) {
        this.db = db;
        this._createStores();
        this.success();
    };

    DBObject.prototype._createStores = function() {
        var that = this;
        Array.prototype.forEach.call(this.db.objectStoreNames,function(n) {
            new IndexedStore(that,n);
        });
    }

    DBObject.prototype.success = function(onsuccess) {
        if(onsuccess === undefined) for(var k in this.onsuccesses) (this.onsuccesses[k])(this);
        if(onsuccess instanceof Function) this.onsuccesses.push(onsuccess);
        return this;
    };
    DBObject.prototype.error = function(onerror) {
        if(onerror === undefined) for(var k in this.onerrors) (this.onerrors[k])(this.lastError);
        if(onerror instanceof Function) this.onerrors.push(onerror);
        return this;
    };
    DBObject.prototype.get = function(store,id,callback) {
        var t = this.db.transaction(store);
        t.oncomplete = function() { callback && callback(data); }
        var data = null;
        var st = t.objectStore(store);
        if(id instanceof Array) {
            data = {};
            id.forEach(function(v) { st.get(v).onsuccess = function(r) { data[v] = r.target.result; };});
        } else {
            st.get(id).onsuccess = function(r) {data = r.target.result;};
        }
        return t;
    };
    DBObject.prototype._find = function(store,index,keyRange,callback) {
        var t = this.db.transaction(store);
        var s = t.objectStore(store);
        if(index) s = s.index(index);
        var c = s.openCursor(keyRange);
        c.onsuccess = function(e) {
            var cursor = e.target.result;
            if(cursor) {
                callback && callback(cursor.value);
                cursor.continue();
            } else {
                callback && callback(null);
            }
        }
        return t;
    };
    DBObject.prototype.filter = function(store,index,keyRange,filter,callback) {
        var data = [];
        return this._find(store,index,keyRange,function(e){
            if(e) {
                if(!filter || filter(e)) data.push(e);
            } else {
                callback && callback(data);
            }
        });
    };
    DBObject.prototype.prefixSearch = function(store,index,prefix,callback) {
        var first = ''+prefix;
        if(prefix.length) {
            var last = first.slice(0,first.length-1) + String.fromCharCode(first.slice(first.length-1,first.length).charCodeAt()+1); //turn abc into abd
            return this.find(store,index,IDBKeyRange.bound(first,last,false,true),callback);
        } else {
            return this.find(store,index,null,callback);
        }
    };
    DBObject.prototype.find      = function(store,index,keyRange,callback) { return this.filter(store,index,keyRange,null,callback); };
    DBObject.prototype.findValue = function(store,index,value,callback) { return this.find(store,index,IDBKeyRange.only(value),callback) };
    DBObject.prototype.getAll    = function(store,callback) { return this.find(store,null,null,callback); };
    DBObject.prototype.put = function(store,object,done) {
        var t = this.db.transaction(store, "readwrite");
        if(done) t.oncomplete = function() { done && done(object) };
        var s = t.objectStore(store);
        (object instanceof Array ? object : [object]).forEach(function(o) { s.put(o); });
        return t;
    };
    DBObject.prototype.count = function(store,index,keyRange,done) {
        var t = this.db.transaction(store);
        var s = t.objectStore(store);
        if(index) s = s.index(index);
        s.count(keyRange).onsuccess = function(e) { done && done(e.target.result) };
        return t;
    }
    DBObject.prototype.remove  = function(store,id, done) {
        var t = this.db.transaction(store,"readwrite");
        t.oncomplete = function() { done && done(); }
        var s = t.objectStore(store);
        (id instanceof Array ? id : [id]).forEach(function(v) { s.delete(v); });
        return t;
    };
    DBObject.prototype.close = function() {
        this.db.close();
    }
    DBObject.prototype.delete = function() {
        name = this.db.name;
        this.close();
        indexedDB.deleteDatabase(name);
    }

    //Class for version change events - allows you to create an alter stores and keys
    function VersionChangeDBObject(db,oldVersion,newVersion,r) {
        DBObject.call(this,db.result);
        this.vtdb = db;
        this.eventualDB = r;
        this.oldVersion = oldVersion;
        this.newVersion = newVersion;
    }
    VersionChangeDBObject.prototype = Object.create(DBObject.prototype);
    VersionChangeDBObject.prototype.createStore = function(name,pk,indexes) {
        var s = null;
        if(typeof pk == "string") {
            s = this.db.createObjectStore(name, {keyPath: pk});
        } else if(pk instanceof Object) {
            s = this.db.createObjectStore(name,pk);
        } else {
            s = this.db.createObjectStore(name);
        }
        this.addIndexToStore(s,indexes);
        return s;
    };
    VersionChangeDBObject.prototype.addIndexToStore = function(store,index) {
        if(!index) return;
        if(!(store instanceof IDBObjectStore)) store = this.vtdb.transaction.objectStore(store);
        if(!(index instanceof Array)) index = [index];
        index.forEach(function(i){
            if(i instanceof Object) {
                store.createIndex(i.index,i.index,i.properties);
            } else {
                store.createIndex(i,i,{unique:false});
            }
        });
    };
    VersionChangeDBObject.prototype.deleteStore = function(name) {
        this.db.deleteObjectStore(name);
    }
    VersionChangeDBObject.prototype.deleteAllStores = function() {
        var that = this;
        Array.prototype.forEach.call(this.db.objectStoreNames,function(n) {
            that.deleteStore(n);
        });
    }

    function keyToFunctionName(str) {
        return str.trim().replace(/(^|_+|\s+)[a-z]/g,function(m){return m.slice(-1).toUpperCase();})
    }

    function IndexedStore(db,name) {
        var that = this;
        this.db = db;
        this.name = name;
        this.db.stores[this.name] = this;
        var s = db.db.transaction(name).objectStore(name);
        this.pk = s.keyPath;
        this.putPreprocessors = [];
        this.indexPreprocessors = {};
        if(this.pk) {
            this['getBy'+keyToFunctionName(this.pk)] = function(value,callback) {
                return this.db.get(this.name,this.indexPreprocess(this.pk,value),callback);
            }
            this.addIndexFunctions(null,this.pk);
        }
        Array.prototype.forEach.call(s.indexNames,function(n) { that.addIndexFunctions(n); });
    }

    IndexedStore.prototype.addIndexFunctions = function(index, canonical) {
        var realName = keyToFunctionName(canonical || index);
        var storeName = index ? index : this.pk;
        var that = this;
        this.indexPreprocessors[storeName] = []

        this['findBy'+realName] = function(keyRange,callback) {
            return this.db.find(this.name,index,keyRange,callback);
        };
        this['_findBy'+realName] = function(keyRange,callback) {
            return this.db._find(this.name,index,keyRange,callback);
        }
        this['findValueBy'+realName] = function(value,callback) {
            return this.db.findValue(this.name,index,this.indexPreprocess(index,value),callback);
        };
        this['findByPrefixOf'+realName] = function(value,callback) {
            return this.db.prefixSearch(this.name,index,this.indexPreprocess(index,value),callback);
        };
        this['filterBy'+realName] = function(keyRange,filter,callback) {
            return this.db.filter(this.name,index,keyRange,filter,callback);
        };
        this['countBy'+realName] = function(value,callback) {
            return this.db.count(this.name,index,IDBKeyRange.only(value),callback);
        };
        this[realName+'Preprocessor'] = function(f) {
            return this.indexPreprocessor(index,f);
        };
        this.putPreprocessor(function(i) {
            if(i.hasOwnProperty(storeName)) i[storeName] = that.indexPreprocess(storeName,i[storeName]);
            return i;
        });
    }

    IndexedStore.prototype.get = function(item, callback) {
        return this.db.get(this.name,this.indexPreprocess(this.pk,item),callback);
    }

    IndexedStore.prototype.getAll = function(callback) {
        return this.db.getAll(this.name,callback);
    }

    IndexedStore.prototype.putPreprocessor = function(preprocessor) {
        if(preprocessor instanceof Function) this.putPreprocessors.push(preprocessor);
        return this;
    }

    IndexedStore.prototype.putPreprocess = function(item) {
        for(var i = 0, j = this.putPreprocessors.length; i < j; i++) item = (this.putPreprocessors[i])(item);
        return item;
    }

    IndexedStore.prototype.indexPreprocessor = function(index,preprocessor) {
        if(!index) index = this.pk;
        if(preprocessor instanceof Function) this.indexPreprocessors[index].push(preprocessor);
        return this;
    }

    IndexedStore.prototype.indexPreprocess = function(index, value) {
        for(var i = 0, j = this.indexPreprocessors[index].length; i < j; i++) value = (this.indexPreprocessors[index][i])(value);
        return value;
    }

    IndexedStore.prototype.put = function(item,done) {
        if(!item) return;
        var that = this;
        return this.db.put(this.name,(item instanceof Array ? item : [item]).map(function(i) {
            return that.putPreprocess(i);
        }),done);
    }

    IndexedStore.prototype.remove = function(id,done) {
        if(!id) return;
        var that = this;
        return this.db.remove(this.name,(id instanceof Array ? id : [id]).map(function(e) {
            return that.indexPreprocess(that.pk,e instanceof Object ? e[that.pk] : e);
        }),done);
    }

    IndexedStore.prototype.count = function(done) {
        return this.db.count(this.name,null,null,done);
    }

    window.indexed = function(database, versions, onsuccess) {
        if(!(versions instanceof Array)) versions = [versions];
        if(!versions.length) throw "Must pass at least one version callback";
        var version = versions.length;

        debug && console.log('Requesting DB ' + database + 'v' + version);
        var request = indexedDB.open(database,version);
        var r = new DBObject();
        onsuccess instanceof Function && r.success(onsuccess);

        request.onsuccess = function(e) {
            if(e.target.result.setVersion && e.target.result.version != version) { //old versions of indexeddb
                debug && console.log('Detected old IndexedDB setup using setVersion');
                var vr = e.target.result.setVersion(version);
                vr.onsuccess = function(e2) {
                    e2.oldVersion = e.target.result.version;
                    e2.newVersion = version;
                    request.onupgradeneeded(e2);
                    r._init(e.target.result);
                    this.debug && console.log('done');
                }
            } else {
                r._init(e.target.result);
                this.debug && console.log('done');
            }
        };

        request.onupgradeneeded = function(e) {
            this.debug && console.log('onupgradeneeded');
            this.debug && console.log(e);
            var oV = e.oldVersion || 0, nV = e.newVersion || version;
            var vco = new VersionChangeDBObject(e.currentTarget, oV, nV, r);
            debug && console.log('Old version: ' + oV + ', new version: ' + nV)
            versions.slice(oV,nV).forEach(function(v){
                if(!(v instanceof Function)) throw "Version callbacks must be functions";
                v(vco);
                vco.oldVersion++;
            });
        };

        request.onerror = function(e) { r.lastError = e; r.error(); };
        request.onblocked = function(event) { alert("Please close all other windows that are currently accessing this page."); };

        return r;
    }
})(window);
