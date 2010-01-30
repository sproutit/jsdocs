/** Called automatically by JsDoc Toolkit. */
var Link = require("jsdocs/frame/link").Link;
var console = require("system").log;
var plugins = require("jsdocs/plugin-manager");
var Symbol = require("jsdocs/symbol").Symbol;
var DocComment = require("jsdocs/doc-comment").DocComment;
var FILE = require("file");
var Template = require("json-template").Template;

var GLOBAL = "_global_";
exports.publish = function publish(symbolSet, options) {
    var extension = Link.ext = ".html" || options.extension;
    var template = options.template;
    var encoding = "utf-8" || options.encoding;
    var style = template.join("static", "default.css").read().toString();
    var header = template.join("static", "header.html").read().toString();
    
    var destination = options.destination;

    // is source output is suppressed, just display the links to the source file
    if (options.includeSource && Link !== undefined && Link.prototype._makeSrcLink) {
        Link.prototype._makeSrcLink = function(srcFilePath) {
            return "&lt;" + srcFilePath + "&gt;";
        }
    }

    // create the folders and subfolders to hold the output
    var symbols = Link.symbolsDir = destination.join("symbols");
    var dirs = Link.srcDir = symbols.join("src");
    if (!dirs.exists()) dirs.mkdirs();

    // used to allow Link to check the details of things being linked to
    Link.symbolSet = symbolSet;

    // create the required templates    
    //var classTemplate = Template(template.join("class.tmpl").read().toString());
    var classesTemplate = Template(template.join("allclasses.tmpl").read().toString());

    // some ustility filters
    function hasNoParent($) {return ($.memberOf == "")}
    function isaFile($) {return ($.is("FILE"))}
    function isaClass($) {return ($.is("CONSTRUCTOR") || $.isNamespace)}

    // get an array version of the symbolset, useful for filtering
    var symbols = symbolSet.toArray();

    // create the hilited source code files
    var files = options.files;
    if (options.includeSource) {
        for (var i = 0, l = files.length; i < l; i++) {
            makeSrcFile(files[i], destination.join("symbols", "src"), null, options.encoding);
        }
    }

     // get a list of all the classes in the symbolset
     var classes = symbols.filter(isaClass).sort(makeSortby("alias"));

    // create a filemap in which outfiles must be to be named uniquely, ignoring case
    if (options.unique) {
        var filemapCounts = {};
        Link.filemap = {};
        for (var i = 0, l = classes.length; i < l; i++) {
            var lcAlias = classes[i].alias.toLowerCase();

            if (!filemapCounts[lcAlias]) filemapCounts[lcAlias] = 1;
            else filemapCounts[lcAlias]++;

            Link.filemap[classes[i].alias] =
                (filemapCounts[lcAlias] > 1)?
                lcAlias+"_"+filemapCounts[lcAlias] : lcAlias;
        }
    }

    // create a class index, displayed in the left-hand column of every class page
    // TODO: don't access this damn Link
    Link.base = "../";
    var classesLink = Link().toFile("index.html").withText("Class Index");
    var filesLink = Link().toFile("files.html").withText("File Index");
    
    var classesIndex = classesTemplate.expand({ // kept in memory
        classesLink: classesLink,
        filesIndex: filesIndex,
        items: classes.map(function(item) {
            var alias = item.alias, link = Link().toClass(alias);
            return (alias == GLOBAL) ? "<i>" + link + "</i>" : link;
        })
    });

    // create each of the class pages
    for (var i = 0, l = classes.length; i < l; i++) {
        var symbol = classes[i];

        symbol.events = symbol.getEvents();   // 1 order matters
        symbol.methods = symbol.getMethods(); // 2


        Link.currentSymbol = symbol;
        var name = uniqueNames ? Link.filemap[symbol.alias] : symbol.alias;
        destination.join("symbols", name + extension).write(classTemplate.expand({
            
        }));
    }

    // regenerate the index with different relative links, used in the index pages
    Link.base = "";
    // TODO: don't access this damn Link
    global.conf.classesIndex = classesTemplate.process(classes);

    // create the class index page
    var classesindexTemplate = new JsPlate(template.join("index.tmpl").read().toString(), "index.tmpl");
    var classesIndex = classesindexTemplate.process(classes);
    destination.join("index" + conf.extension).write(classesIndex);
    classesindexTemplate = classesIndex = classes = null;

    // create the file index page
    var fileindexTemplate = new Template(template.join("allfiles.tmpl").read().toString());

    var documentedFiles = symbols.filter(isaFile); // files that have file-level docs
    var allFiles = []; // not all files have file-level docs, but we need to list every one

    for (var i = 0; i < files.length; i++) {
        allFiles.push(new Symbol(files[i], [], "FILE", new DocComment("/** */")));
    }

    for (var i = 0; i < documentedFiles.length; i++) {
        var offset = files.indexOf(documentedFiles[i].alias);
        allFiles[offset] = documentedFiles[i];
    }

    allFiles = allFiles.sort(makeSortby("name"));

    // output the file index page
    var filesIndex = fileindexTemplate.expand({
        title: new Link().toFile("files.html").withText("File Index"),
        files: allFiles
    });
    destination.join("files" + conf.extension).write(filesIndex);
    fileindexTemplate = filesIndex = files = null;
}


/** Just the first sentence (up to a full stop). Should not break on dotted variable names. */
function summarize(desc) {
    if (typeof desc != "undefined")
        return desc.match(/([\w\W]+?\.)[^a-z0-9_$]/i)? RegExp.$1 : desc;
}

/** Make a symbol sorter by some attribute. */
function makeSortby(attribute) {
    return function(a, b) {
        if (a[attribute] != undefined && b[attribute] != undefined) {
            a = a[attribute].toLowerCase();
            b = b[attribute].toLowerCase();
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        }
    }
}

/** Pull in the contents of an external file at the given path. */
function include(path) {
    return template.join(path).read().toString();
}

/** Turn a raw source file into a code-hilited page in the docs. */
function makeSrcFile(path, destination, name, encoding) {
    if (!name) {
        name = path.toString()
            .replace(/\.\.?[\\\/]/g, "")
            .replace(/[\\\/]/g, "_")
            .replace(/\:/g, "_");
    }
    var content, src;
    plugins.notify("onPublishSrc", (src = {
        path: path,
        name: name,
        charset: encoding,
        highlighted: null
    }));
    if (content = src.highlighted) destination.join(name + conf.extension).write(content);
}

/** Build output for displaying function parameters. */
function makeSignature(params) {
    if (!params) return "()";
    var signature = "("
    +
    params.filter(
        function($) {
            return $.name.indexOf(".") == -1; // don't show config params in signature
        }
    ).map(
        function($) {
            return $.name;
        }
    ).join(", ")
    +
    ")";
    return signature;
}


/**
    @constructor
*/
var Link = require("jsdocs/frame/link").Link;

// TODO: fix this global dependencies
var encoding, VERSION, copyright;

var JsPlate = exports.JsPlate = function JsPlate(template, templateFile) {
    this.template = template;

    this.templateFile = templateFile;
    this.code = "";
    this.parse();
};
JsPlate.prototype = {
    constructor: JsPlate,
    parse: function() {
        this.template = this.template.replace(/\{#[\s\S]+?#\}/gi, "");
        this.code = "var output=\u001e"+this.template;

        this.code = this.code.replace(
            /<for +each="(.+?)" +in="(.+?)" *>/gi,
            function (match, eachName, inName) {
                return "\u001e;\rvar $"+eachName+"_keys = keys("+inName+");\rfor(var $"+eachName+"_i = 0; $"+eachName+"_i < $"+eachName+"_keys.length; $"+eachName+"_i++) {\rvar $"+eachName+"_last = ($"+eachName+"_i == $"+eachName+"_keys.length-1);\rvar $"+eachName+"_key = $"+eachName+"_keys[$"+eachName+"_i];\rvar "+eachName+" = "+inName+"[$"+eachName+"_key];\routput+=\u001e";
            }
        );
        this.code = this.code.replace(/<if test="(.+?)">/g, "\u001e;\rif ($1) { output+=\u001e");
        this.code = this.code.replace(/<elseif test="(.+?)"\s*\/>/g, "\u001e;}\relse if ($1) { output+=\u001e");
        this.code = this.code.replace(/<else\s*\/>/g, "\u001e;}\relse { output+=\u001e");
        this.code = this.code.replace(/<\/(if|for)>/g, "\u001e;\r};\routput+=\u001e");
        this.code = this.code.replace(
            /\{\+\s*([\s\S]+?)\s*\+\}/gi,
            function (match, code) {
                code = code.replace(/"/g, "\u001e"); // prevent qoute-escaping of inline code
                code = code.replace(/(\r?\n)/g, " ");
                return "\u001e+ ("+code+") +\u001e";
            }
        );
        this.code = this.code.replace(
            /\{!\s*([\s\S]+?)\s*!\}/gi,
            function (match, code) {
                code = code.replace(/"/g, "\u001e"); // prevent qoute-escaping of inline code
                code = code.replace(/(\n)/g, " ");
                return "\u001e; "+code+";\routput+=\u001e";
            }
        );
        this.code = this.code+"\u001e;";

        this.code = this.code.replace(/(\r?\n)/g, "\\n");
        this.code = this.code.replace(/"/g, "\\\"");
        this.code = this.code.replace(/\u001e/g, "\"");
    },
    toCode: function() {
        return this.code;
    },
    keys: function(obj) {
        var keys = [];
        if (obj.constructor.toString().indexOf("Array") > -1) {
            for (var i = 0; i < obj.length; i++) {
                keys.push(i);
            }
        } else {
            for (var i in obj) {
                keys.push(i);
            }
        }
        return keys;
    },
    values: function(obj) {
        var values = [];
        if (obj.constructor.toString().indexOf("Array") > -1) {
            for (var i = 0; i < obj.length; i++) {
                values.push(obj[i]);
            }
        }
        else {
            for (var i in obj) {
                values.push(obj[i]);
            }
        }
        return values;
    },
    process: function(data, compact) {
        var keys = this.keys;
        var values = this.values;
        try {
            eval(this.code);
        } catch (e) {
            print(">> There was an error evaluating the compiled code from template: "+this.templateFile);
            print("   The error was on line "+e.lineNumber+" "+e.name+": "+e.message);
            var lines = this.code.split("\r");
            if (e.lineNumber-2 >= 0) print("line "+(e.lineNumber-1)+": "+lines[e.lineNumber-2]);
            print("line "+e.lineNumber+": "+lines[e.lineNumber-1]);
            print("");
        }

        if (compact) { // patch by mcbain.asm
            // Remove lines that contain only space-characters, usually left by lines in the template
            // which originally only contained JSPlate tags or code. This makes it easier to write
            // non-tricky templates which still put out nice code (not bloated with extra lines).
            // Lines purposely left blank (just a line ending) are left alone.
            output = output.replace(/\s+?(\r?)\n/g, "$1\n");
        }
        /*debug*///print(this.code);
        return output;
    }
};


// TODO: Get read of this messy util crap!!!
var VERSION = "migration to narwhal", copyright;

/** Pull in the contents of an external file at the given path. */
function include(path) {
    return Link.template.join(path).read().toString();
}

/** Find symbol {@link ...} strings in text and turn into html links */
function resolveLinks(str, from) {
    str = str.replace(/\{@link ([^} ]+) ?\}/gi,
        function(match, symbolName) {
            return new Link().toSymbol(symbolName);
        }
    );
    return str;
}

function defined(o) {
        return (o !== undefined);
}

