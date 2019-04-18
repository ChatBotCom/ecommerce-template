'use strict';

const TOKEN = '{{YOUR_TOKEN}}'; // put your authorization token here

const express = require('express');
const { Router } = require('express');
const router = new Router();
const app = express();
const functions = require('firebase-functions');
const firebase = require('firebase-admin');

firebase.initializeApp({
    credential: firebase.credential.applicationDefault(),
    databaseURL: '{{YOUR_DATABASE_URL}}' // put url to your firebase database here
});

// function for calculating the cart value dynamically
const getCartValue = (responses = []) => {
    //start with price = 0
    let globalPrice = 0;

    // Get the item price from the name - collect the number after the dollar symbol
    responses.map(p => {
        const price = p.productName.split('$')[1];

        // add the item price to the global cart value
        globalPrice += Number(price) * Number(p.productQuantity);
    });

    // return cart value
    return `💵 In total: $${globalPrice}USD`;
};

// function for transform order to text
// docs for text fullfillment - https://www.chatbot.com/docs/object-definitions
const transformOrderToText = (responses = []) => {
    let text = '';

    if (!responses.length) {
        return '🤷‍ Your order is empty.';
    }

    responses.map(item => {
        text += `${item.productName} x${item.productQuantity}\n`;
    });

    const cartValue = getCartValue(responses);
    return `${test}\n${cartValue}`;
};

// handling authorization request
router
    .route('/')
    .get((req, res) => {
        if (req.query.token !== TOKEN) {
            return res.sendStatus(401);
        }

        return res.end(req.query.challenge);
    });

router
    .route('/')
    .post((req, res, next) => {
        const action = req.body.result.interaction.action;

        if (['add-product', 'cart', 'start-again'].includes(action)) {
            req.url = `/${action}`;
            return next();
        }

        res.json();
    });

// Add the product to the order
router
    .route('/add-product')
    .post(async (req, res, next) => {
        const { result } = req.body;

        // get attributes collected in the ongoing chat
        const productName = result.sessionParameters.productName;
        const productQuantity = Number(result.sessionParameters.productQuantity) || 1;

        // make a product object based on the collected attributes
        if (productName && productQuantity) {
            req.product = { productName, productQuantity };

            // go to the next part of request handling
            return next();
        }

        // return empty response
        return res.json();
    })
    .post(async (req, res, next) => {
        let order;

        // get the sessionId
        const { sessionId } = req.body;
        const product = req.product;

        try {
            const db = firebase.database();
            const ref = db.ref(sessionId.substring(2));

            // open database transaction; find the order based on the sessionId
            await ref.transaction((data) => {
                if (data == null) {
                    data = [product];
                } else {
                    // find the product and increment the productQuantity or add a new one
                    const findProduct = data.find(item => item.productName === product.productName);

                    if (findProduct) {
                        findProduct.productQuantity += product.productQuantity;
                    } else {
                        data.push(product);
                    }
                }

                // store current shopping bag
                order = data;
                return data;
            });
        } catch (e) {
            next(e);
        }

        // go to the next part
        if (order.length) {
            req.order = order;
            return next();
        }

        return res.json();
    });
    .post(async (req, res) => {
        const data = {
            responses: [
                {
                    type: 'text',
                    elements: ['✅ Product has been added successfully. \n\n🛒 Your cart:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(req.order)] // use function for transform order to the text message
                }
            ]
        };

        // return responses
        res.json(data);
    });

// Return order to a text message
router
    .route('/cart')
    .post(async (req, res, next) => {
        let order;

        // get the sessionId
        const { sessionId } = req.body;

        try {
            const db = firebase.database();
            const ref = db.ref(sessionId.substring(2));

            // open database transaction; save the order
            await ref.transaction((data) => {
                order = data;
                return order;
            });
        } catch (e) {
            next(e);
        }

        res.json({
            responses: [
                {
                    type: 'text',
                    elements: ['🛒 Your order summary:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(order)] // use the function for transform order to the text message
                }
            ]
        });
    });

// Remove order
router
    .route('/start-again')
    .post(async (req, res, next) => {
        // get the sessionId
        const { sessionId } = req.body;

        try {
            const db = firebase.database();
            const ref = db.ref(sessionId.substring(2));

            await ref.transaction(() => {
                return [];
            });
        } catch (e) {
            next(e);
        }

        res.json();
    });

app.use(router);

exports.restaurantBot = functions.https.onRequest((req, res) => {
    if (!req.path) {
        req.url = `/${req.url}`;
    }

    return app(req, res);
});
