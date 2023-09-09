import express from "express";
import pg from "pg"
import { WebSocketServer } from "ws"
import { URL } from "url"
import cors from "cors"

const conString = `postgres://${process.env.DbUser}:${process.env.pwDb}@${process.env.DbIP}:${process.env.DbPORT}/${process.env.DbName}`
const client = new pg.Client(conString)
await client.connect()
const wss = new WebSocketServer({ port: 5555 })
const app = express();
app.use(express.json())
app.use(cors())

function sendPing(ws) {
    ws.send("ping")
}

wss.on("connection", async (ws, req) => {
    const uri = `${process.env.wssDomain}${req.url}`
    const parsedURL = Object.fromEntries(new URL(uri).searchParams.entries())
    const roomId = parsedURL.roomId
    const token = parsedURL.token
    const playerId = parsedURL.playerId
    const wsConnectionKey = (await client.query(`SELECT wsconnection FROM rooms WHERE id = $1;`, [roomId])).rows[0].wsconnection
    if (wsConnectionKey != token) {
        ws.close()
    }
    setInterval(() => sendPing(ws), 20000)
    const endpoint = req.url.split("?")[0]
    const usernameArr = (await client.query(`SELECT name FROM users WHERE relatedroom = $1;`,[roomId])).rows
    const roomAdminId = (await client.query(`SELECT adminplayerid FROM rooms WHERE id = $1;`, [roomId])).rows[0].adminplayerid
    ws.roomId = roomId
    ws.hasBuzzerd = false;
    if (playerId == roomAdminId) {
        ws.admin = true;
        ws.send("admin")
    }
    if (endpoint === "/join") {
        wss.clients.forEach((webSocketFromClient) => {
            if (webSocketFromClient.roomId == roomId) webSocketFromClient.send(JSON.stringify(usernameArr))
        })
        ws.on("message", (message) => {
            message = message.toString()
            if (message == "start") {
                wss.clients.forEach((webSocketFromClient) => {
                    if (webSocketFromClient.roomId == roomId) webSocketFromClient.send(message)
                })
            }
        })
    }
    else if (endpoint === "/play") {
        ws.on("message", async (message) => {
            if (message.toString().startsWith("id:")) {
                ws.hasBuzzerd = true
                const username = (await client.query(`SELECT name FROM users WHERE id= $1;`,[message.toString().replace("id:", "")])).rows[0].name
                wss.clients.forEach((webSocketFromClient) => {
                    if (webSocketFromClient.roomId == roomId) webSocketFromClient.send(username)
                })
            }
            else if (message.toString() == "unlockAll" && ws.admin) {
                wss.clients.forEach((client) => {
                    if (client.roomId == roomId) {
                        client.hasBuzzerd = false;
                        client.send("unlocked")
                    }
                })
            }
            else if (message.toString() == "unlock" && ws.admin) {
                wss.clients.forEach((client) => {
                    if (client.roomId == roomId && client.hasBuzzerd === false) {
                        client.send("unlocked")
                    }
                })
            }
        })
    }
})

app.post("/createRoom", async (req, res) => {
    const username = req.body.username
    const password = req.body.password
    const currentdate = new Date().toISOString().substring(0, 10)
    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow = tomorrow.toISOString().substring(0, 10)
    const wsConnectionKey = Math.random().toString().substring(2, 10)
    try{
        const roomId = (await client.query(`INSERT INTO rooms(createdat, expireat, password, wsconnection) VALUES($1,$2,$3,$4) RETURNING id;`,[currentdate, tomorrow, password, wsConnectionKey])).rows[0].id
        const playerId = (await client.query(`INSERT INTO users (name, relatedroom) VALUES ($1,$2) RETURNING id;`, [username, roomId])).rows[0].id
        await client.query(`UPDATE rooms SET adminPlayerId = $1 WHERE id = $2;`, [playerId, roomId])
        res.send({"worked": true, "name": username, "roomId": roomId, "wsConnectionKey": wsConnectionKey, "playerId": playerId })
    }catch(e){
        res.status(403)
        res.send("Error")
        return
    }
})

app.post("/room/:id/connect", async (req, res) => {
    const username = req.body.username
    const roomId = req.params.id
    const password = req.body.password
    try{
        let rightRoomPassword = await client.query(`SELECT password FROM rooms WHERE id = $1;`, [roomId])
        rightRoomPassword = rightRoomPassword.rows[0].password
        if (password == rightRoomPassword) {
            const playerId = (await client.query(`INSERT INTO users (name, relatedroom) VALUES ($1, $2) RETURNING id;`, [username, roomId])).rows[0].id
            let wsConnectionKey = await client.query(`SELECT wsconnection FROM rooms WHERE id = $1;`, [roomId])
            wsConnectionKey = wsConnectionKey.rows[0].wsconnection
            res.send({ worked: true, "username": username, "wsConnectionKey": wsConnectionKey, "playerId": playerId })
            return;
        }
    }catch(e){
        res.status(403)
        res.send("Error maybe wrong roomid or password")
        return;
    }
    res.send({ worked: false })
})

app.listen(5050, () => {
    console.log("listening on 5050")
})