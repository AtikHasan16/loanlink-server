const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

// firebase admin setup
var admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// mongodb setup
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const e = require("express");
// Connection URI
const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// verify firebase token middleware

const verifyFirebaseToken = async (req, res, next) => {
  // Get the token from the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  try {
    const idToken = authHeader.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.decodedEmail = decodedToken.email;
    // console.log("decoded email", req.decodedEmail);
  } catch (error) {}
  next();
};

app.get("/", (req, res) => {
  res.send("Server is running");
});

const database = client.db("LoanLink");
const usersCollection = database.collection("users");
const loansCollection = database.collection("loans");
const applicationCollection = database.collection("applications");
const paymentInfoCollection = database.collection("payment_info");
// MongoDB connection
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    //******** Middleware to verify roles ******
    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decodedEmail;
      // console.log(decodedEmail);
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // verify manager
    const verifyManager = async (req, res, next) => {
      const decodedEmail = req.decodedEmail;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "manager") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    //******* Stripe payment integration ******** User

    // Checkout API
    app.post(
      "/create-checkout-session",
      verifyFirebaseToken,
      async (req, res) => {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.amount) * 100;
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "USD",
                unit_amount: amount,
                product_data: {
                  name: paymentInfo.loanTitle,
                },
              },

              quantity: 1,
            },
          ],
          customer_email: paymentInfo.customerEmail,
          mode: "payment",
          metadata: {
            loanId: paymentInfo.loanId,
            loanTitle: paymentInfo.loanTitle,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-failed`,
        });
        console.log(session);
        res.send({ url: session.url });
      },
    );

    // after checkout Retrieve API
    app.patch("/payment-success", verifyFirebaseToken, async (req, res) => {
      const querySession = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(querySession);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentInfoCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: "payment info is trying to inject multiple time",
          transactionId,
        });
      }
      console.log(session);
      if (session.payment_status === "paid") {
        const id = session.metadata.loanId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            transactionId: session.payment_intent,
          },
        };
        const result = await applicationCollection.updateOne(query, update);
        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          loanId: session.metadata.loanId,
          loanTitle: session.metadata.loanTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date().toLocaleString(),
        };

        const resultPayment =
          await paymentInfoCollection.insertOne(paymentHistory);
        res.send({
          success: true,
          modifiedApplication: result,
          paymentInfo: resultPayment,
          transactionId: session.payment_intent,
        });
      }
    });

    // *****  Endpoint for user data ***** Admin

    // Endpoint to post users
    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log(user.email);

      const query = { email: user.email };
      const ifExist = await usersCollection.findOne(query);
      // console.log(ifExist?.email);
      if (ifExist?.email === user.email) {
        return res.send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Endpoint to get all users
    app.get("/users", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      console.log(email);

      if (email) {
        const query = { email: email };
        const result = await usersCollection.findOne(query);
        return res.send(result);
      }
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to get single user by id
    app.get("/users/:userId", verifyFirebaseToken, async (req, res) => {
      const id = req.params.userId;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    // Endpoint to get user by role
    app.get("/users/role/:email", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });
    // Endpoint to update user data
    app.patch(
      "/users/:userId",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.userId;
        const filter = { _id: new ObjectId(id) };
        const updatedUser = req.body;
        const update = {
          $set: updatedUser,
        };
        const result = await usersCollection.updateOne(filter, update);
        res.send(result);
      },
    );

    // ****** loan data ******* Manager

    // Endpoint to post loans
    app.post("/loans", verifyFirebaseToken, verifyManager, async (req, res) => {
      const loan = req.body;
      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });
    // Endpoint to get all loans for all loan page
    app.get("/loans", verifyFirebaseToken, verifyManager, async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to get single loan by ID
    app.get(
      "/loans/all-loans/:loanId",
      verifyFirebaseToken,
      async (req, res) => {
        const id = req.params.loanId;
        const query = { _id: new ObjectId(id) };
        const result = await loansCollection.findOne(query);
        res.send(result);
      },
    );

    // endpoint to get 6 loans for home page
    app.get("/loans/home", async (req, res) => {
      const query = { showOnHome: true };
      const result = await loansCollection.find(query).limit(6).toArray();
      res.send(result);
    });
    // endpoint to get all loans for all-loans page
    app.get("/loans/all-loans", async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });
    // endpoint patch to update loan showOnHome from admin all loans
    app.patch(
      "/loans/:loanId",
      verifyFirebaseToken,

      async (req, res) => {
        const id = req.params.loanId;
        const filter = { _id: new ObjectId(id) };
        const update = { $set: { showOnHome: req.body.showOnHome } };
        const result = await loansCollection.updateOne(filter, update);
        res.send(result);
      },
    );

    // Endpoint patch to update loan from admin edit loans
    app.patch(
      "/loans/edit-loan/:loanId",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.loanId;
        const filter = { _id: new ObjectId(id) };
        const updatedLoan = req.body;
        const update = {
          $set: updatedLoan,
        };
        const result = await loansCollection.updateOne(filter, update);
        res.send(result);
      },
    );
    // endpoint to delete loans from manage loan
    app.delete("/loans/:loanId", verifyFirebaseToken, async (req, res) => {
      const id = req.params.loanId;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.deleteOne(query);
      res.send(result);
    });

    // **** loan application API *******

    // endpoint for loanApplication post
    app.post("/loanApplication", verifyFirebaseToken, async (req, res) => {
      const applicationData = req.body;
      const result = await applicationCollection.insertOne(applicationData);
      res.send(result);
    });
    // get all loan applications
    app.get(
      "/loanApplications",
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        const result = await applicationCollection.find().toArray();
        res.send(result);
      },
    );
    // endpoint for get loanApplication for user with email and  status
    app.get("/loanApplication", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      console.log(email);

      const { status } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;

        if (email !== req.decodedEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      if (email) {
        const query = { userEmail: email };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
      if (status === "pending") {
        const query = { status: status };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
      if (status === "approved") {
        const query = { status: status };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
    });

    // Endpoint for manager to update status rejected or approved
    app.patch(
      "/loanApplication/:applicationId",
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        const id = req.params.applicationId;
        const { currentStatus } = req.body;
        const filter = { _id: new ObjectId(id) };
        if (currentStatus === "approved") {
          const update = {
            $set: {
              status: "approved",
              approvedAt: new Date().toLocaleString(),
            },
          };
          const result = await applicationCollection.updateOne(filter, update);
          res.send(result);
        }
        if (currentStatus === "rejected") {
          const update = { $set: { status: "rejected" } };
          const result = await applicationCollection.updateOne(filter, update);
          res.send(result);
        }
        if (currentStatus === "pending") {
          const update = { $set: { status: "pending" } };
          const result = await applicationCollection.updateOne(filter, update);
          res.send(result);
        }
        if (currentStatus === "cancelled") {
          const update = {
            $set: {
              status: "cancelled",
              cancelledAt: new Date().toLocaleString(),
            },
          };
          const result = await applicationCollection.updateOne(filter, update);
          res.send(result);
        }
      },
    );

    // *********** Payment info ************

    app.get("/payment-info", verifyFirebaseToken, async (req, res) => {
      const transactionId = req.query.transactionId;
      console.log(transactionId);

      const query = { transactionId: transactionId };
      const result = await paymentInfoCollection.findOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (err) {
    console.error(err);
  }
}
run();

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
