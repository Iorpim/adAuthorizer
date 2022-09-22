var { parse, buildSchema, validate } = require("graphql");
var jwt = require("jsonwebtoken");
var AWS = require("aws-sdk");
if(!fetch) {
    var fetch = require("node-fetch");
}

var schema = buildSchema("schema {\r\n    query: Query\r\n    mutation: Mutation\r\n    subscription: Subscription\r\n  }\r\n  \r\n  type Mutation {\r\n    createUpdateMessage(input: CreateUpdateMessageInput!): updateMessage\r\n    deleteUpdateMessage(input: DeleteUpdateMessageInput!): updateMessage\r\n    updateUpdateMessage(input: UpdateUpdateMessageInput!): updateMessage\r\n  }\r\n  \r\n  type Query {\r\n    getUpdateMessage(userid: ID!): updateMessage\r\n    listUpdateMessages(filter: TableUpdateMessageFilterInput, limit: Int, nextToken: String): updateMessageConnection\r\n  }\r\n  \r\n  type Subscription {\r\n    onCreateUpdateMessage: updateMessage\r\n    onDeleteUpdateMessage(userid: ID!): updateMessage\r\n    onUpdateUpdateMessage(userid: ID!): updateMessage\r\n  }\r\n  \r\n  type updateMessage {\r\n    payload: String!\r\n    userid: ID!\r\n  }\r\n  \r\n  type updateMessageConnection {\r\n    items: [updateMessage]\r\n    nextToken: String\r\n  }\r\n  \r\n  input CreateUpdateMessageInput {\r\n    payload: String!\r\n    userid: ID!\r\n  }\r\n  \r\n  input DeleteUpdateMessageInput {\r\n    userid: ID!\r\n  }\r\n  \r\n  input TableBooleanFilterInput {\r\n    eq: Boolean\r\n    ne: Boolean\r\n  }\r\n  \r\n  input TableFloatFilterInput {\r\n    between: [Float]\r\n    contains: Float\r\n    eq: Float\r\n    ge: Float\r\n    gt: Float\r\n    le: Float\r\n    lt: Float\r\n    ne: Float\r\n    notContains: Float\r\n  }\r\n  \r\n  input TableIDFilterInput {\r\n    beginsWith: ID\r\n    between: [ID]\r\n    contains: ID\r\n    eq: ID\r\n    ge: ID\r\n    gt: ID\r\n    le: ID\r\n    lt: ID\r\n    ne: ID\r\n    notContains: ID\r\n  }\r\n  \r\n  input TableIntFilterInput {\r\n    between: [Int]\r\n    contains: Int\r\n    eq: Int\r\n    ge: Int\r\n    gt: Int\r\n    le: Int\r\n    lt: Int\r\n    ne: Int\r\n    notContains: Int\r\n  }\r\n  \r\n  input TableStringFilterInput {\r\n    beginsWith: String\r\n    between: [String]\r\n    contains: String\r\n    eq: String\r\n    ge: String\r\n    gt: String\r\n    le: String\r\n    lt: String\r\n    ne: String\r\n    notContains: String\r\n  }\r\n  \r\n  input TableUpdateMessageFilterInput {\r\n    userid: TableIDFilterInput\r\n  }\r\n  \r\n  input UpdateUpdateMessageInput {\r\n    payload: String!\r\n    userid: ID!\r\n  }");

AWS.config.update({region: "us-east-2"});

var secret = "zd0tq1ad8rzb48e2xcqica6j7zct89";
var client_id = "8gej984rx3ypt104fl0gkncne8z6sn";
var api_url = "https://api.twitch.tv/helix/";

var ddb = new AWS.DynamoDB({apiVersion: "2012-08-10"});

var TableName = "messageAuthTable";

var JWT_SECRET = "very real and safe secret *taidaSip*";

async function broadcasterGet(broadcasterId) {
    var params = {
        TableName: TableName,
        Key: {
            "broadcaster_id": {N: broadcasterId}
        }
    };
    return new Promise((resolve, reject) => {
        ddb.getItem(params, function(err, data) {
            if(err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

function getFetch(url, params) {
    return new Promise((resolve, reject) => {
        fetch(url, params).then(x => x.text()).then(y => resolve(y)).catch(e => reject(e));
    });
}

function encodeTwitchAuthToken(token) {
    return JSON.stringify(token);
}

function decodeTwitchAuthToken(token) {
    return JSON.parse(token);
}

async function handleAuth(jwt, resource, target) {
    if(jwt.target != target) {
        throw new Error(`Target "${target}" mismatch: "${jwt.target}"`);
    }
    switch(resource) {
        case "createUpdateMessage":
        case "updateUpdateMessage":
            if(jwt.scope.indexOf("write") < 0) {
                return false;
            }
            break;
        case "getUpdateMessage":
        case "onUpdateUpdateMessage":
            if(jwt.scope.indexOf("read") < 0) {
                return false;
            }
            break;
        default:
            throw new Error(`Invalid resource ${resource}`);
    }
    console.log(target);
    var r = await broadcasterGet(target);
    if(!("Item" in r)) {
        throw new Error(`Target ${target} is not registered`);
    }
    var broadcaster = r.Item;
    var user = jwt.userid;
    var allowedUser = (broadcaster.allowed_users && (broadcaster.allowed_users.SS.map(e => e.split(":")[0]).indexOf(user) >= 0));
    console.log(broadcaster);
    console.log(broadcaster.allowed_users.SS);
    if(broadcaster.mods_only.BOOL || broadcaster.auto_allow_mods.BOOL) {
        var API = new _API(decodeTwitchAuthToken(broadcaster.twitch_auth_token.S));
        await API.testToken(broadcaster);
        var mods = JSON.parse(await API.moderators(broadcaster.broadcaster_id.N, user));
        console.log(mods);
        var mod = mods.length == 1;
        if(mod) {
            return broadcaster.auto_allow_mods.BOOL ? true : allowedUser;
        } else {
            return broadcaster.mods_only.BOOL ? false : allowedUser;
        }
    }
    return allowedUser;
}

async function broadcasterUpdate(broadcaster) {
    var params = {
        TableName: TableName,
        Item: broadcaster
    };
    return new Promise((resolve, reject) => {
        ddb.putItem(params, function(err, data) {
            if(err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

class _API {
    constructor(token){
        this.token = token;
    }


    static getToken(url) {
        var [r, a] = url.split("?");
        a = parse(a);
        return this._getToken(a.code, r);
    }

    static _getToken(code, r) {
        return getFetch("https://id.twitch.tv/oauth2/token", {
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            "body": `client_id=${client_id}&client_secret=${secret}&code=${code}&grant_type=authorization_code&redirect_uri=${r}`,
            "method": "POST"
        });
    }

    async refreshToken() {
        var token = JSON.parse(await getFetch("https://id.twitch.tv/oauth2/token", {
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            "body": `client_id=${client_id}&client_secret=${secret}&grant_type=refresh_token&refresh_token=${this.token.refresh_token}`,
            "method": "POST"
        }));
        if(token.status == 401) {
            console.error(token);
            throw new Error("Invalid broadcaster refresh_token.");
        }
        this.token = token;
        return this.token;
    }

    getHeaders() {
        return {
            "Authorization": `Bearer ${this.token.access_token}`,
            "Client-Id": client_id
        };
    }

    async getAPI(endpoint) {
        var r = await getFetch(api_url + endpoint, {
            "headers": this.getHeaders(),
        });
        if(JSON.parse(r).status == 401) {
            throw new Error("Unauthorized");
        }
        return r;
    }

    users(usernames = "", ids = "") {
        var endpoint = "users";
        var params = [];
        if(ids.length) {
            if(ids instanceof Array) {
                ids = ids.join(",");
            }
            params = params.concat(`id=${ids}`);
        }
        if(usernames.length) {
            if(usernames instanceof Array) {
                usernames = usernames.join(",");
            }
            params = params.concat(`login=${usernames}`);
        }
        if(params) {
            endpoint = `users?${params.join("&")}`;
        }
        return this.getAPI(endpoint);
    }

    user() {
        return this.getAPI("users");
    }

    moderators(broadcaster_id, userIds = [], first = 100, after = "") {
        var endpoint = `moderation/moderators?broadcaster_id=${broadcaster_id}&first=${first}`;
        if(userIds.length) {
            if("," in userIds) {
                userIds = userIds.split(",");
            }
            if(userIds instanceof Array) {
                userIds = userIds.join("&user_id=");
            }
            endpoint += `&user_id=${userIds}`;
        }
        return this.getAPI(endpoint);
    }

    async testToken(broadcaster) {
        try { return (await this.user()); } catch {
            var token = await this.refreshToken();
            broadcaster.twitch_auth_token.S = encodeTwitchAuthToken(token);
            await broadcasterUpdate(broadcaster);
            return false;
        }
    }
}

function parseValue(argument, variables) {
    switch(argument.kind) {
        case "StringValue":
            return argument.value;
        case "Variable":
            if(!(argument.name.value in variables)) {
                throw new Error(`Invalid variable name ${argument.name.value} provided`);
            }
            return variables[argument.name.value];
        default:
            throw new Error(`Invalid argument kind ${argument.kind}`);
    }
}

function parseArgument(argument, variables) {
    var value = argument.value;
    var ret = {}

    ret[argument.name.value] = parseValue(value, variables);

    return ret;
}

function parseField(field, variables) {
    var arguments = field.arguments;
    var ret = {};
    var r = [];

    for(var i = 0; i < arguments.length; i++) {
        var argument = arguments[i];
        r.push(parseArgument(argument, variables));
    }

    ret[field.name.value] = r;

    return ret;
}

function parseOperation(operation, variables) {
    var selections = operation.selectionSet.selections;
    var ret = [];

    for(var i = 0; i < selections.length; i++) {
        var selection = selections[i];
        ret.push(parseField(selection, variables));
    }

    return ret;
}

function parseQuery(queryString, variables, schema = false, operationName = false) {
    var query = parse(queryString);
    var operations = !operationName ? 
                    query.definitions :
                    query.definitions.filter(e => e.name.value == operationName);
    var ret = {}

    if(schema) {
        validate(schema, query);
    }

    for(var i = 0; i < operations.length; i++) {
        var operation = operations[i];
        if(operation.name.value in ret) {
            throw new Error("Duplicate operation name found.");
        }
        ret[operation.name.value] = parseOperation(operation, variables);
    }

    return ret;
}


exports.handler = async (event) => {
    // TODO implement
    console.log(JSON.stringify(event, null, 2));
    /*const response = {
        statusCode: 200,
        body: JSON.stringify('Hello from Lambda!'),
    };*/
    var response = {};
    try {
        var token = jwt.verify(event.authorizationToken, JWT_SECRET);
        if(event.requestContext["queryString"] == "" && event.requestContext["operationName"] == "Deepdish:Connect" && Object.keys(event.requestContext["variables"]).length == 0) {
            console.log("Authorizing weird request");
            return {
                "isAuthorized": true,
                "deniedFields": [
                    "*"
                ]
            };
        }
        var query = parse(event.requestContext["queryString"]);
        var t = validate(schema, query);
        if(t.length > 0) {
            console.error(t);
            throw new Error("Invalid query");
        }
        if(event.requestContext["operationName"]) {
            var definitions = query.definitions.filter(e => e.name.value == event.requestContext["operationName"]);
        } else {
            var definitions = query.definitions;
        }
        var authorized = false;
        var deniedFields = [ "*" ];
        for(var i = 0; i < definitions.length; i++) {
            var definition = definitions[i];
            console.log(definition);
            if(definition.selectionSet.selections.length != 1) {
                console.error(query.definitions);
                throw new Error("Invalid queries");
            }
            var selection = definition.selectionSet.selections[0];
            console.log(selection);
            var argument = selection.arguments.filter(e => (e.name ? e.name.value == "userid" : false))[0].value;
            console.log(argument);
            var target;
            switch(argument.kind) {
                case "Variable":
                    target = event.requestContext["variables"][argument.name.value];
                    break;
                case "StringValue":
                    target = argument.value;
                    break;
                default:
                    throw new Error(`Invalid argument kind ${argument.kind}`);
            }
            if(await handleAuth(token, selection.name.value, target)) {
                console.log(`Authorized ${selection.name.value} access to ${target} for ${token.userid}`);
                if(i == 0) {
                    authorized = true;
                    deniedFields = [];
                }
                continue;
                /*response = {
                    "isAuthorized": true,
                    "deniedFields": []
                };*/
            } else {
                console.log(`Rejected ${selection.name.value} access to ${target} for ${token.userid}`);
                authorized = false;
                deniedFields = [ "*" ];
                /*response = {
                    "isAuthorized": false,
                    "deniedFields": [
                        "*"
                    ]
                };*/
            }
            //response.isAuthorized = true;
        }
    } catch(e) {
        console.log(e);
        return {
            "isAuthorized": false,
            "deniedFields": [
                "*"
            ]
        };
    }
    /*var resources = {};
    for(var i = 0; i < query.definitions; i++) {
        var selections = query.definitions[i].selectionSet.selections;
        for(var l = 0; l < selections.length; l++) {
            r = selections[l].name.value;
            if(!(r in resources)) {
                resources[r] = [];
            }
            var arguments = selections[l].arguments;
            for(var j = 0; j < arguments.length; j++) {
                arguments
            }
            resources[r].concat()
        }
    }*/
    response = {
        "isAuthorized": authorized,
        "deniedFields": deniedFields
    }
    return response;
};
