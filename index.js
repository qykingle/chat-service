// const express = require("express");
import express from 'express'
import {ChatGPTAPI} from 'chatgpt'

const port = process.env.PORT || 4000;
const app = express();
app.all('*', (_, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Authorization,X-API-KEY, Origin, X-Requested-With, Content-Type, Accept, Access-Control-Request-Method')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE')
    res.header('Allow', 'GET, POST, PATCH, OPTIONS, PUT, DELETE')
    next();
})


const ErrorCodeMessage = {
    401: '[OpenAI] 提供错误的API密钥 | Incorrect API key provided',
    403: '[OpenAI] 服务器拒绝访问，请稍后再试 | Server refused to access, please try again later',
    502: '[OpenAI] 错误的网关 |  Bad Gateway',
    503: '[OpenAI] 服务器繁忙，请稍后再试 | Server is busy, please try again later',
    504: '[OpenAI] 网关超时 | Gateway Time-out',
    500: '[OpenAI] 服务器繁忙，请稍后再试 | Internal Server Error',
}

function sendResponse(options) {
    if (options.type === 'Success') {
        return Promise.resolve({
            message: options.message ?? null,
            data: options.data ?? null,
            status: options.type,
        })
    }

    // eslint-disable-next-line prefer-promise-reject-errors
    return Promise.reject({
        message: options.message ?? 'Failed',
        data: options.data ?? null,
        status: options.type,
    })
}


function isNotEmptyString(value) {
    return typeof value === 'string' && value.length > 0
}

const model = isNotEmptyString(process.env.OPENAI_API_MODEL) ? process.env.OPENAI_API_MODEL : 'gpt-3.5-turbo'

const timeoutMs = !isNaN(+process.env.TIMEOUT_MS) ? +process.env.TIMEOUT_MS : 100 * 1000


let api
let apiModel = 'ChatGPTAPI'

const init = async (openAPIKey) => {
    if (isNotEmptyString(process.env.OPENAI_API_KEY || openAPIKey)) {
        const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://ai98.vip'

        const options = {
            apiKey: process.env.OPENAI_API_KEY || openAPIKey, completionParams: {model}, debug: !disableDebug,
        }

        // increase max token limit if use gpt-4
        if (model.toLowerCase().includes('gpt-4')) {
            // if use 32k model
            if (model.toLowerCase().includes('32k')) {
                options.maxModelTokens = 32768
                options.maxResponseTokens = 8192
            } else {
                options.maxModelTokens = 8192
                options.maxResponseTokens = 2048
            }
        } else if (model.toLowerCase().includes('gpt-3.5')) {
            if (model.toLowerCase().includes('16k')) {
                options.maxModelTokens = 16384
                options.maxResponseTokens = 4096
            }
        }

        if (isNotEmptyString(OPENAI_API_BASE_URL)) options.apiBaseUrl = `${OPENAI_API_BASE_URL}/v1`

        api = new ChatGPTAPI({...options})
        apiModel = 'ChatGPTAPI'
    }
}


async function chatReplyProcess(options) {
    if (!api) {
        await init(options.openAPIKey)
    }

    const {message, lastContext, process, systemMessage, temperature, top_p} = options
    try {
        let options = {timeoutMs}

        if (apiModel === 'ChatGPTAPI') {
            if (isNotEmptyString(systemMessage)) options.systemMessage = systemMessage
            options.completionParams = {model, temperature, top_p}
        }

        if (lastContext != null) {
            if (apiModel === 'ChatGPTAPI') {
                options.parentMessageId = lastContext.parentMessageId
            } else {
                options = {...lastContext}
            }
        }

        const response = await api.sendMessage(message, {
            ...options, onProgress: (partialResponse) => {
                process?.(partialResponse)
            },
        })

        return sendResponse({type: 'Success', data: response})
    } catch (error) {
        const code = error.statusCode
        global.console.log(error)
        if (Reflect.has(ErrorCodeMessage, code)) return sendResponse({type: 'Fail', message: ErrorCodeMessage[code]})
        return sendResponse({type: 'Fail', message: error.message ?? 'Please check the back-end console'})
    }
}

app.get('/hello-world', (request, response) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY
    const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL
    const OPENAI_API_MODEL = process.env.OPENAI_API_MODEL
    response.send(`OPENAI_API_KEY: ${OPENAI_API_KEY} \n OPENAI_API_BASE_URL: ${OPENAI_API_BASE_URL} \n OPENAI_API_MODEL: ${OPENAI_API_MODEL}`);
});

app.post('/api/session', async (req, res) => {
    try {
        res.send({status: 'Success', message: '', data: {auth: true, model: 'ChatGPTAPI'}})
    } catch (error) {
        res.send({status: 'Fail', message: error.message, data: null})
    }
})

app.post('/api/verify', async (req, res) => {
    try {
        const {token} = req.body
        if (!token) throw new Error('Secret key is empty')

        if (process.env.AUTH_SECRET_KEY !== token) throw new Error('密钥无效 | Secret key is invalid')

        res.send({status: 'Success', message: 'Verify successfully', data: null})
    } catch (error) {
        res.send({status: 'Fail', message: error.message, data: null})
    }
})


app.post('/api/chat-process', async (req, res) => {
    res.setHeader('Content-type', 'application/octet-stream')

    try {
        const {prompt, options = {}, systemMessage, temperature, top_p, openAPIKey, token} = req.body
        let firstChunk = true
        await chatReplyProcess({
            message: prompt, openAPIKey, token, lastContext: options, process: (chat) => {
                res.write(firstChunk ? JSON.stringify(chat) : `\n${JSON.stringify(chat)}`)
                firstChunk = false
            }, systemMessage, temperature, top_p,
        })
    } catch (error) {
        res.write(JSON.stringify(error))
    } finally {
        res.end()
    }
})


app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
});

// Export the Express API
export default app
