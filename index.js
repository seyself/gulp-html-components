'use strict';

var through = require('through2');
var gutil = require('gulp-util');
var path = require('path');
var _ = require('lodash');
var fs = require('fs');
var CleanCSS = require('clean-css');
var UglifyJS = require("uglify-js");
var jsbeautify = require('js-beautify').js;
var cssbeautify = require('js-beautify').css;
var htmlbeautify = require('js-beautify').html;
var htmlMinify = require('html-minifier').minify;

var cssCodes = [];
var jsCodes = [];
var styleList = [];
var scriptList = [];
var currentPath = "";
var componentPath = "";
var destPath = "";
var srcPath = "";

module.exports = function (options)
{
  currentPath = process.cwd();
  componentPath = options.components;
  destPath = options.dest;
  srcPath = options.src;

  function transform(file, encoding, callback)
  {
    console.log("'gulp-html-components': " + path.relative(process.cwd(), file.path));
    styleList = [];
    scriptList = [];

    if (file.isNull())
    {
      this.push(file);
      return callback();
    }

    if (file.isStream())
    {
      this.emit('error', new gutil.PluginError('gulp-html-components', 'Streaming not supported'));
      return callback();
    }

    var content = file.contents.toString();

    content = content.replace(/<(\w+\-[^>\s]+)\s?(.|\s)*?(<\/\1>)/igm, //コンポーネントタグを抜き出す // <...> 〜 </...>
        function(text)
        {
          var item = text;
          var items = item.match(/<(\w+\-[^>\s]+)\s?(.|\s)*?>/i); // 開始タグとタグ名を取り出す // [ <tag-name attr='...'>, tag-name, ...]
          if (items)
          {
            item = items[0];
          }
          else
          {
            item = null;
          }
          if (item && items.length > 2)
          {
            var name = items[1];
            var tagContent = getTagContent(item, name, text);
            var matches = item.match(/\s([\w\-]+)(=('|").+?\3)?/ig); // タグの属性を分解して取り出す // [ aaa='1', bbb='true', ccc, ...]
            var data = parseAttributes(matches);
            data.yield = tagContent;
            return loadComponent(name, data);
          }
          return text;
        }
    );

    content = writeStyles(file.path, content);
    content = writeScripts(file.path, content);

    content = htmlMinify(content, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      preserveLineBreaks: true
    });
    content = content.replace(/>\s+</g, "><");

    var tmpScriptCodes = [""];
    var tmpScriptCodesNum = 0;
    content = content.replace(/<script[^>]*type="x-shader\/x-(fragment|vertex)"[^>]*>(.|\s)*?(<\/script>)/igm,
        function(text){
          tmpScriptCodes.push(text);
          tmpScriptCodesNum++;
          return "<!--{{{ script-code-" + tmpScriptCodesNum + " }}}-->";
        }
    );
    content = htmlbeautify(content, {
      end_with_newline: true
    });
    content = content.replace(/<\!--{{{ script-code-(\d+) }}}-->/igm,
        function(text, num){
          return tmpScriptCodes[Number(num)];
        }
    );

    file.contents = new Buffer(content);
    this.push(file);
    callback();
  }

  function flush(callback) 
  {
    writeFiles(cssCodes);
    writeFiles(jsCodes);
    callback();
  }

  return through.obj(transform, flush);
};

function getTagContent(beginTag, tagName, content)
{
  content = content.replace(beginTag, '');
  content = content.replace('</' + tagName + '>', '');
  content = content.replace(/[\s\t\r\n]+$/ig, '');
  content = content.replace(/^[\s\t\r\n]+/ig, '');
  return content;
}

function writeFiles(list)
{
  var len = list.length;
  for(var i=0; i<len; i++)
  {
    var item = list[i];
    var dir = path.relative(currentPath, path.dirname(item.dest));
    writeFileFunction(dir, item);
  }
}

function writeFileFunction(dir, item)
{
  if (fs.existsSync(dir))
  {
    fs.writeFileSync(item.dest, item.code);
  }
  else
  {
    fs.mkdirSync(dir);
    fs.writeFileSync(item.dest, item.code);
  }
}

/** 使用しているCSSのコードをまとめる */
function writeStyles(filepath, html)
{
  var code = "";
  var list = styleList;
  var len = list.length;
  var readFiles = [];
  for(var i=0; i<len; i++)
  {
    var item = list[i];
    if (item.code)
    {
      //まったく同じコードは読まない
      if (readFiles.indexOf(item.code) < 0)
      {
        code += item.code;
        readFiles.push(item.code);
      }
    }
    else
    if (item.src)
    {
      try
      {
        //1回読んだファイルは読まない
        if (readFiles.indexOf(item.src) < 0)
        {
          var text = fs.readFileSync(item.src, 'utf8');
          code += text;
          readFiles.push(item.src);
        }
      }
      catch(err)
      {
        code += "/**" + String(err) + "*/\n";
      }
    }
  }

  if (code)
  {
    var dest = getDestPath(filepath, 'css');
    var mincss = new CleanCSS().minify(code);

    if (mincss.errors.length == 0)
      code = mincss.styles;

    // if (mincss.errors.length > 0) console.log(mincss.errors.join('\n'));
    // if (mincss.warnings.length > 0) console.log(mincss.warnings.join('\n'));

    code = cssbeautify(code);
    cssCodes.push({dest:dest, code:code});

    var absolutePath = "/" + path.relative(destPath, dest);
    html = html.replace('</head>', '\n<link rel="stylesheet" href="' + absolutePath + '" />\n</head>');
  }

  return html;
}

/** 使用しているJavaScriptのコードをまとめる */
function writeScripts(filepath, html)
{
  var code = "";
  var list = scriptList;
  var len = list.length;
  var readFiles = [];
  var srcList = [];
  for(var i=0; i<len; i++)
  {
    var item = list[i];
    if (item.code)
    {
      //まったく同じコードは読まない
      if (readFiles.indexOf(item.code) < 0)
      {
        code += item.code;
        readFiles.push(item.code);
      }
    }
    else
    if (item.src)
    {
      try
      {
        //1回読んだファイルは読まない
        if (readFiles.indexOf(item.src) < 0)
        {
          if (item.src.match(/^(https?:)?\/\/.+/))
          {
            srcList.push('<script src="' + item.src + '"></script>');
          }
          else
          {
            var text = fs.readFileSync(item.src, 'utf8');
            code += text;
          }
          readFiles.push(item.src);
        }
      }
      catch(err)
      {
        code += "/**" + String(err) + "*/\n";
      }
    }
  }
  var code2 = srcList.join('\n');
  if (code)
  {
    //code = UglifyJS.minify(code, {fromString:true}).code;
    code = jsbeautify(code);
    var dest = getDestPath(filepath, 'js');
    jsCodes.push({dest:dest, code:code});

    var absolutePath = "/" + path.relative(destPath, dest);
    code2 += '\n<script src="' + absolutePath + '"></script>';
  }

  html = html.replace('</body>', code2 + '\n</body>');
  return html;
}

/** タグの属性をパースしてオブジェクトで返す */
function parseAttributes(attrs)
{
  var data = {};
  if (!attrs) return data;

  var len = attrs.length;
  for(var i=0; i<len; i++)
  {
    var attr = attrs[i];
    attr = attr.replace(/^\s/, '');
    attr = attr.split("=");
    var key = attr.shift();
    var value = attr.shift();
    if (value === undefined) value = null;
    if (value != null)
    {
      value = value.replace(/^['"]/, "");
      value = value.replace(/['"]$/, "");
    }
    data[key] = value;
  }
  return data;
}

/** コンポーネントファイルを読み込んで、データを置き換えて返す */
function loadComponent(name, data)
{
  var result = "";
  try
  {
    var current = process.cwd();

    // package.json　から main に指定されたファイルパスを取得する
    var jsonPath = getRelativePath(name + '/package.json');
    var json = fs.readFileSync(jsonPath, enc);
    json = JSON.parse(json);
    var filePath = getRelativePath(name + '/' + json.main);
    var enc = 'utf8';
    var componentPath = path.dirname(filePath);
    var text = fs.readFileSync(filePath, enc);
    text = parseHTML(text);
    if (data && text)
    {
      try
      {
        text = _.template(text)(data);
        // console.log(text, data);
      }
      catch(err)
      {
        // console.log(err);
        text += "<!-- " + String(err) + " -->\n";
      }
    }
    text = parseStyles(componentPath, text);
    text = parseScripts(componentPath, text);
    result = text;
  }
  catch(err)
  {
    result = "<!-- " + String(err) + " -->\n";
  }
  return result;
}

function parseHTML(html)
{
  var result = "";
  var body = html.match(/<body[^>]*>((.|\s)*)?<\/body>/im);
  var head = html.match(/<head[^>]*>((.|\s)*)?/im);
  if (head) head = head[1].split('</head>')[0];
  if (body) body = body[1];
  if (!body && !head) {
    return html;
  }
  if (head)
  {
    var links = head.match(/<link[^>]*(rel=("|')stylesheet("|'))[^>]*(\/?>|<\/link>)/ig);
    var styles = head.match(/<style[^>]*>(.|\s)*?<\/style>/igm);
    var scripts = head.match(/<script[^>]*>(.|\s)*?<\/script>/igm);
    if (links)   result += links.join('\n')   + '\n';
    if (styles)  result += styles.join('\n')  + '\n';
    if (scripts) result += scripts.join('\n') + '\n';
  }
  if (body)
  {
    result += body;
  }
  return result;
}


/** コンポーネントで使用しているスタイルシートを分離する */
function parseStyles(componentPath, text)
{
  text = text.replace(/<link[^>]*(rel=("|')stylesheet("|'))[^>]*(\/?>|<\/link>)/ig,
      function(link){
        var filepath = link.match(/<link[^>]*\shref="([^"]+.s?css)"/i);
        if (filepath)
        {
          filepath = componentPath + '/' + filepath[1];
          styleList.push({src:filepath, code:null});
        }
        return "";
      });
  text = text.replace(/<style[^>]*>(.|\s)*?<\/style>/igm,
      function(code){
        try
        {
          code = code.replace(/^<style[^>]*>/i, "");
          code = code.replace(/<\/style>$/i, "");
          styleList.push({src:null, code:code});
        }
        catch(err)
        {
          // console.log(err);
        }
        return "";
      });
  return text;
}

/** コンポーネントで使用しているスクリプトを分離する */
function parseScripts(componentPath, text)
{
  text = text.replace(/<script[^>]*>(.|\s)*?<\/script>/igm,
      function(script){
        var filepath = script.match(/<script[^>]*\ssrc="([^"]+)"/i);
        if (filepath)
        {
          filepath = filepath[1];
          if (!filepath.match(/^(https?:)?\/\/.+/))
          {
            filepath = componentPath + '/' + filepath;
          }
          scriptList.push({src:filepath, code:null});
        }
        else
        {
          try
          {
            var code = script.replace(/^<script[^>]*>/i, "");
            code = code.replace(/<\/script>$/i, "");
            scriptList.push({src:null, code:code});
          }
          catch(err)
          {
            // console.log(err);
          }
        }
        return "";
      });
  return text;
}

/** 外部ファイルのパスを取得する */
function getDestPath(filepath, exp)
{
  var dir = path.dirname(filepath, '.html');
  var name = path.basename(filepath, '.html');
  var writepath = path.resolve(dir, name + '.' + exp);
  var srcPath2 = srcPath.replace(/(\*+).+/, '');
  var dest = path.resolve(destPath, path.relative(srcPath2, writepath));
  dest = path.relative(currentPath, dest);
  return dest;
}

/** コンポーネントのファイルパスを取得する */
function getRelativePath(filename)
{
  return path.relative(currentPath, path.resolve(componentPath, filename));
}