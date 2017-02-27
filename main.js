var specialChars = ",.;?:/*-+{}()".split("");

var AlignsAndPadsGLSL = {
    bool: 1,
    int: 1,
    uint: 1,
    float: 1,
    vec2: 2,
    vec3: 4,
    vec4: 4,
    ivec2: 2,
    ivec3: 4,
    ivec4: 4,
    uvec2: 2,
    uvec3: 4,
    uvec4: 4
}

var AlignsAndPadsC = {
    bool: 1,
    int: 1,
    uint: 1,
    float: 1,
    vec2: 2,
    vec3: 3,
    vec4: 4,
    ivec2: 2,
    ivec3: 3,
    ivec4: 4,
    uvec2: 2,
    uvec3: 3,
    uvec4: 4
}


var ConvertToC = function()
{
    var tokens = Tokenize(document.querySelector("#glsl-source").value);
    var result = "#pragma pack(push,1)\n";
    var structs = ExtractStructs(tokens);
    
    structs.forEach(function(struct) {
        console.log("Alignment/padding for struct \"" + struct.name + "\": -> " + GetStructAlignmentAndPad(struct) + " <- 32-bit units");
        result += BuildStructCodeC(PadGLSLStruct(struct, {})) + "\n";
    });

    var buffers = ExtractBuffers(tokens);
    buffers.forEach(function(buffer) {
        console.log("Alignment/padding for struct \"" + buffer.name + "\": -> " + GetStructAlignmentAndPad(buffer) + " <- 32-bit units");
        result += BuildBufferCodeC(PadGLSLStruct(buffer, structs)) + "\n";
    });

    result += "#pragma pack(pop)\n";
    document.querySelector("#c-source").value = result;
}

var Tokenize = function(glsl)
{
    glsl = glsl.replace(/\s/g, " ");
    glsl = glsl.split(" ").filter(function(n) { return n !== ""; });
    glsl = [].concat.apply([], glsl);

    specialChars.forEach(function(c) {
        glsl = glsl.map(function(item) {
            var sp = "" + item;

            if(sp === c)
                return [c];
            else
            {
                sp = sp.split(c);
                sp = sp.map(function(n) { if(n === "") return c; return n; });
                return sp;
            }
        });
        glsl = [].concat.apply([], glsl);
    });

    return glsl;
}

var ExtractStructs = function(tokens)
{
    const STATE_IDLE                  = 0;
    const STATE_EXPECTING_STRUCT_NAME = 1;
    const STATE_EXPECTING_STRUCT_OPEN = 2;
    const STATE_EXPECTING_MEMBER_TYPE = 3;
    const STATE_EXPECTING_MEMBER_NAME = 4;
    const STATE_EXPECTING_MEMBER_END  = 5;

    var currentState = STATE_IDLE;

    var sCurrent = null;
    var sRetVal = [];

    var mType = "";
    var mName = "";

    var currentDepth = 0;
    tokens.forEach(function(token) {
        switch(token)
        {
        case "struct":
            console.assert(currentState === STATE_IDLE);
            sCurrent = { name:"", members: [] };
            currentState = STATE_EXPECTING_STRUCT_NAME;
            break;

        case ";":
            if(currentState === STATE_EXPECTING_MEMBER_END)
            {
                console.assert(sCurrent !== null);
                var obj = {};
                obj[mName] = mType;
                sCurrent.members.push(obj);
                currentState = STATE_EXPECTING_MEMBER_TYPE;
            }
            break;

        case "{":
            ++currentDepth;
            if(sCurrent !== null)
                currentState = STATE_EXPECTING_MEMBER_TYPE;
            break;

        case "}":
            --currentDepth;
            if(currentDepth === 0 && sCurrent !== null)
            {
                sRetVal.push(sCurrent);
                sCurrent = null;
                currentState = STATE_IDLE;
            }
            break;

        default:
            switch(currentState)
            {
            case STATE_EXPECTING_STRUCT_NAME:
                console.assert(sCurrent !== null);
                sCurrent.name = token;
                currentState = STATE_EXPECTING_STRUCT_OPEN;
                break;

            case STATE_EXPECTING_MEMBER_TYPE:
                console.assert(sCurrent !== null);
                mType = token;
                currentState = STATE_EXPECTING_MEMBER_NAME;
                break;

            case STATE_EXPECTING_MEMBER_NAME:
                console.assert(sCurrent !== null);
                mName = token;
                currentState = STATE_EXPECTING_MEMBER_END;
                break;

            case STATE_IDLE:
                break;

            default:
                console.error("Unexpected token \"" + token + "\"");
                console.assert(false);
            }
        }
    });
    return sRetVal;
}

var GetStructAlignmentAndPad = function(s)
{
    var maxAlignPad = 0;
    s.members.forEach(function(m) {
        var mPad = AlignsAndPadsGLSL[Object.values(m)[0]];
        if(mPad > maxAlignPad)
            maxAlignPad = mPad;
    });

    return maxAlignPad;
}

var PadGLSLStruct = function(orig, existingStructs)
{
    var padId = 0;
    var curStructSize = 0;

    var retval = { name: orig.name, members: [] };

    orig.members.forEach(function(m) {
        var mPadGLSL = AlignsAndPadsGLSL[Object.values(m)[0]];
        var mPadC    = AlignsAndPadsC[Object.values(m)[0]];

        if(typeof(mPadGLSL) === "undefined")
        {
            var i = -1;

            for(var j = 0; j < existingStructs.length; j++)
            {
                if(existingStructs[j].name == Object.values(m)[0])
                {
                    i = j;
                    break;
                }
            }

            if(i == -1)
            {
                console.error("Illegal use of undefined struct \"" + Object.values(m)[0] + "\"");
                console.assert(false);
            }

            mPadGLSL = GetStructAlignmentAndPad(existingStructs[i]);
            mPadC    = mPadGLSL;
        }

        var misalign = curStructSize % mPadGLSL;

        if(misalign !== 0)
        {
            var objPad = {};
            objPad["pad_" + padId + "[" + (4 - misalign) + "]"] = "float";
            retval.members.push(objPad);
            padId++;

            curStructSize += misalign;
        }

        var obj = {};
        obj[Object.keys(m)[0]] = Object.values(m)[0];
        retval.members.push(obj);

        if(mPadC !== mPadGLSL)
        {
            var objPad = {};
            objPad["pad_" + padId + "[" + (mPadGLSL - mPadC) + "]"] = "float";
            retval.members.push(objPad);
            padId++;
        }

        curStructSize += mPadGLSL;
    });

    return retval;
}

var BuildStructCodeC = function(s)
{
    var sRetVal = "struct " + s.name + "\n{\n";

    s.members.forEach(function(m) {
        sRetVal += "    " + Object.values(m)[0] + " " + Object.keys(m)[0] + ";\n"
    });

    sRetVal += "};\n";
    return sRetVal;
}

var BuildBufferCodeC = function(s)
{
    var bRetVal = "/* STD430 buffer */ struct" + s.name + "\n{\n";

    s.members.forEach(function(m) {
        bRetVal += "    " + Object.values(m)[0] + " " + Object.keys(m)[0] + ";\n"
    });

    bRetVal += "};\n";
    return bRetVal;
}

var ExtractBuffers = function(tokens)
{
    var i = 0;
    while(tokens[i] !== "layout" && tokens[i] !== "buffer")
            i++;

    if(tokens[i] === "layout")
    {
        console.log("Skipping layout qualifier");
        while(tokens[i] !== ")")
            i++;
    }
    
    tokens = tokens.splice(i + 1);
    
    const STATE_IDLE                  = 0;
    const STATE_EXPECTING_BUFFER_NAME = 1;
    const STATE_EXPECTING_BUFFER_OPEN = 2;
    const STATE_EXPECTING_BUFFER_END  = 3;
    const STATE_EXPECTING_BUFFER_VAR  = 4;
    const STATE_EXPECTING_MEMBER_TYPE = 5;
    const STATE_EXPECTING_MEMBER_NAME = 6;
    const STATE_EXPECTING_MEMBER_END  = 7;

    var currentState = STATE_IDLE;

    var bCurrent = null;
    var bRetVal = [];

    var mType = "";
    var mName = "";

    var currentDepth = 0;
    tokens.forEach(function(token) {
        switch(token)
        {
        case "buffer":
            console.assert(currentState === STATE_IDLE);
            bCurrent = { name:"", members: [] };
            currentState = STATE_EXPECTING_BUFFER_NAME;
            break;

        case ";":
            if(currentState === STATE_EXPECTING_MEMBER_END)
            {
                console.assert(bCurrent !== null);
                var obj = {};
                obj[mName] = mType;
                bCurrent.members.push(obj);
                currentState = STATE_EXPECTING_MEMBER_TYPE;
            }

            if(currentState === STATE_EXPECTING_BUFFER_END)
            {
                if(currentDepth === 0 && bCurrent !== null)
                {
                    bRetVal.push(bCurrent);
                    bCurrent = null;
                }
                currentState = STATE_IDLE;
            }

            break;

        case "{":
            ++currentDepth;
            if(bCurrent !== null)
                currentState = STATE_EXPECTING_MEMBER_TYPE;
            break;

        case "}":
            --currentDepth;
            currentState = STATE_EXPECTING_BUFFER_VAR;
            break;

        default:
            switch(currentState)
            {
            case STATE_EXPECTING_BUFFER_NAME:
                console.assert(bCurrent !== null);
                bCurrent.name = token;
                currentState = STATE_EXPECTING_BUFFER_OPEN;
                break;

            case STATE_EXPECTING_BUFFER_VAR:
                currentState = STATE_EXPECTING_BUFFER_END;
                break;

            case STATE_EXPECTING_MEMBER_TYPE:
                console.assert(bCurrent !== null);
                mType = token;
                currentState = STATE_EXPECTING_MEMBER_NAME;
                break;

            case STATE_EXPECTING_MEMBER_NAME:
                console.assert(bCurrent !== null);
                mName = token;
                currentState = STATE_EXPECTING_MEMBER_END;
                break;

            case STATE_IDLE:
                break;

            default:
                console.error("Unexpected token \"" + token + "\"");
                console.assert(false);
            }
        }
    });

    return bRetVal;
}
