
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Product = require("../../models/productSchema");
const Cart = require("../../models/cartSchema");
const Category = require("../../models/categorySchema");
const addToCart = async (req, res) => {
  const user = req.session.user;
  const { productId } = req.body;

  if (!user) {
    return res.status(401).json({ success: false, message: 'You must be logged in to add items to your cart' });
  }

  try {
    // Fetch the user's cart from the database
    let cart = await Cart.findOne({ userId: user._id });

    if (!cart) {
      // Initialize a new cart if it doesn't exist
      cart = new Cart({ userId: user._id, items: [], cartTotal: 0 });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Check if the item already exists in the cart
    const existingItem = cart.items.find(item => item.productId.toString() === productId);
    if (existingItem) {
      // Check if the product is in stock before adding more to the cart
      if (existingItem.quantity < product.quantity && existingItem.quantity < 5) {
        existingItem.quantity += 1;
        existingItem.totalPrice = existingItem.quantity * product.salePrice;
      } else {
        return res.status(400).json({ success: false, message: 'Cannot add more of this product to the cart (Out of stock or limit reached)' });
      }
    } else {
      // Add the product to the cart if it doesn't already exist
      if (product.quantity > 0) {
        cart.items.push({
          productId,
          quantity: 1,
          price: product.salePrice,
          totalPrice: product.salePrice,
        });
      } else {
        return res.status(400).json({ success: false, message: 'Product is out of stock' });
      }
    }

    // Recalculate cart total
    cart.cartTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);

    // Save the updated cart to the database
    await cart.save();

    // Optionally, update the product stock after an item is added to the cart (if your system requires this)
    // product.quantity -= 1;
    // await product.save();

    // Also save the cart in the session (if you want to use session for quick access)
    req.session.cart = cart;

    res.status(200).json({ success: true, message: 'Product added to cart', cart });
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};
const getCartPage = async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || !user._id) {
      console.error('No valid user found in session');
      return res.redirect('/login');
    }

    const userId = user._id;
    console.log('Session User:', user);

    // Fetch user details including wallet
    const userDetails = await User.findById(userId).select('wallet transactions');
    const walletBalance = userDetails.wallet || 0;

    // Log user details fetched from database
    console.log('User Details:', userDetails);

    // Find the cart for the user and populate product details
    const cart = await Cart.findOne({ userId }).populate('items.productId');

    if (!cart || cart.items.length === 0) {
      console.log('No items found in cart for user:', userId);
      return res.render('cart', {
        cartItems: [],
        cartSubtotal: 0,
        cartTax: 0,
        cartTotal: 0,
        totalItems: 0,
        user,
        hasOutOfStockItems: false,
        walletBalance,
        remainingAmountToPay: 0,
      });
    }

    // Map cart items with product details
    const cartItems = cart.items
      .map(item => {
        const product = item.productId;
        if (!product) return {}; // Returning empty object instead of null
        const priceToShow = Math.min(product.salePrice, product.regularPrice);
        return {
          id: product._id,
          name: product.productName,
          image: product.productImage[0],
          regularPrice: product.regularPrice,
          salePrice: product.salePrice,
          price: priceToShow,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          stock: product.quantity,
        };
      })
      .filter(item => item.id); // Ensures only valid products are kept

    // Calculate cart totals
    const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const cartSubtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const taxRate = 0.1; // You can make this configurable
    const cartTax = cartSubtotal * taxRate;
    const cartTotal = cartSubtotal + cartTax;
    req.session.updatedAmount=cartTotal;
    let discountedAmount = cartTotal;

    // Apply coupon discount if applied
    const applyCoupon = req.session.couponApplied;
    if (applyCoupon) {
      discountedAmount = Math.max(cartTotal - req.session.couponDiscount, 0);
    }

    // Apply wallet balance if applied
    const applyWallet = req.session.applyWallet;
    let remainingAmountToPay = cartTotal;

    if (applyCoupon) {
      remainingAmountToPay -= req.session.couponDiscount;
    }

    if (applyWallet) {
      remainingAmountToPay -= walletBalance;
    }

    remainingAmountToPay = Math.max(remainingAmountToPay, 0);

    // Log session data for debugging
    if (applyWallet) {
      console.log('Session Data (Wallet Applied):', req.session);
      console.log('Remaining Amount to Pay:', remainingAmountToPay);
      console.log('Wallet Balance:', walletBalance);
      console.log('Cart Items:', cartItems);
      console.log('Cart Subtotal:', cartSubtotal);
      console.log('Cart Tax:', cartTax);
      console.log('Total Items:', totalItems);
    }

    const hasOutOfStockItems = cartItems.some(item => item.quantity > item.stock);

    return res.render('cart', {
      cartItems,
      cartSubtotal,
      cartTax,
      cartTotal,
      totalItems,
      user,
      hasOutOfStockItems,
      walletBalance,
      remainingAmountToPay,
    });
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};

const incrementQuantity = async (req, res) => {
  try {
    const { productId } = req.body; // Extract product ID from request body
    const userId = req.session.user._id; // Get the user's ID from the session

    // Fetch the cart for the user
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.render('error', { errorMessage: 'Cart not found' });
    }

    // Check if the product exists in the cart
    const cartItem = cart.items.find(item => item.productId.toString() === productId);
    if (!cartItem) {
      return res.render('error', { errorMessage: 'Product not found in cart' });
    }

    // Fetch the product details to check stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.render('error', { errorMessage: 'Product not found' });
    }

    console.log('Available stock:', product.quantity);

    // Check stock and max quantity constraints
    if (cartItem.quantity >= product.quantity) {
      return res.render('error', { errorMessage: 'Product is out of stock' });
    }
    if (cartItem.quantity >= 5) {
      return res.render('error', { errorMessage: 'Maximum allowed quantity reached' });
    }

    // Increment the quantity and update the total price
    cartItem.quantity += 1;
    cartItem.totalPrice = cartItem.quantity * cartItem.price;

    // Recalculate the cart total
    cart.cartTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);

    // Save the updated cart
    await cart.save();

    // Redirect to the cart page to show the updated quantity
    return res.redirect('/cart');
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};


// Decrement Quantity
const decrementQuantity = async (req, res) => {
  try {
    const { productId } = req.body;  // Assuming productId is sent in the body
    const userId = req.session.user._id;


    // Find the cart for the user
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).send('Cart not found');
    }

    // Find the cart item
    const cartItem = cart.items.find(item => item.productId.toString() === productId);

    if (!cartItem) {
      return res.status(404).send('Product not found in cart');
    }

    // Ensure the quantity doesn't go below 1
    if (cartItem.quantity > 1) {
      cartItem.quantity -= 1;
      cartItem.totalPrice = cartItem.quantity * cartItem.price;

      // Recalculate the cart total
      cart.cartTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);

      await cart.save();
      return res.redirect('/cart');  // Redirect to the cart page to see updated cart
    } else {
      return res.status(400).send('Quantity cannot be less than 1');
    }
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};
const removeFromCart = async (req, res) => {
  const { productId } = req.body;
  const userId = req.session.user._id;  // Assuming user is logged in and user ID is available

  try {
    // Find the cart for the user
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    // Find the cart item
    const cartItemIndex = cart.items.findIndex(item => item.productId.toString() === productId.toString());

    if (cartItemIndex === -1) {
      return res.status(404).json({ message: 'Product not found in cart' });
    }

    // Remove the product from the cart
    cart.items.splice(cartItemIndex, 1);

    // Recalculate the cart total
    cart.cartTotal = cart.items.reduce((total, item) => total + item.totalPrice, 0);

    // Save the updated cart
    await cart.save();

    res.status(200).json({ success: true, message: 'Product removed from cart', cart });
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};
const getCheckout = async (req, res) => {
  try {
    const user = req.session.user;
    
    // Retrieve the user's saved addresses from the database
    const userAddresses = await Address.find({ userId: user._id });

    // If userAddresses is found, extract the 'address' field (array)
    const savedAddresses = userAddresses.length > 0 ? userAddresses[0].address : [];
    const selectedAddress = req.session.selectedAddress || null;
    // Render the checkout page with saved addresses
    res.render('checkout', { 
      selectedAddress,
      savedAddresses: savedAddresses 
    });
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};
const selectAddress = async (req, res) => {
  console.log("selectAddress function called");
  try {
    const { selectedAddress } = req.body;
    console.log("Selected address:", selectedAddress);
    console.log("Request body:", req.body);

    // Check if selectedAddress is provided
    if (!selectedAddress) {
      return res.render('error', { errorMessage: 'Internal Server Error' });    }

    const userId = req.session.user._id;
    console.log("User ID from session:", userId);

    // Fetch the Address document associated with the user
    const userAddressData = await Address.findOne({ userId: userId });

    if (!userAddressData) {
      return res.status(400).json({ message: "No address found for the user." });
    }

    console.log("User's addresses:", userAddressData.address);

    // Check if the selected address ID matches any address in the address array
    const validAddress = userAddressData.address.find(
      addr => addr._id.toString() === selectedAddress
    );

    if (!validAddress) {
      return res.status(400).json({ message: "Invalid address selected." });
    }

    // Save the selected address to the session
    req.session.selectedAddress = validAddress;
    console.log("Selected address saved in session:", req.session.selectedAddress);
    


     return res.redirect("/checkout");
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};


const saveAddress = async (req, res) => {
  try {
      const { name, addressType, city, state, pincode, phone, altPhone } = req.body;

      // Validate required fields
      if (!name || !city || !state || !pincode || !phone) {
          return res.status(400).json({ message: "Please fill all required fields." });
      }

      // Create the selectedAddress object
      const selectedAddress = {
          name,
          addressType,
          city,
          state,
          pincode,
          phone,
          altPhone: altPhone || '' // Default to an empty string if altPhone is not provided
      };

      // Store the selectedAddress in the session
      req.session.selectedAddress = selectedAddress;

      // Redirect to the checkout page
      res.redirect('/checkout');
  } catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};
const productDetails = async (req, res) => {
  try {
    const userId = req.session.user;
    const userData = await User.findById(userId);

    // Correctly extract productId
    const productId = req.query.id;
    if (!productId) {
      return res.render('error', { errorMessage: 'Product ID not provided' });
    }

    // Fetch the product and its category
    const product = await Product.findById(productId).populate('category');
    if (!product) {
      return res.render('error', { errorMessage: 'Product not found' });
    }

    const findCategory = product.category || {}; // Handle missing category
    const categoryOffer = findCategory.categoryOffer || 0;
    const productOffer = product.productOffer || 0;
    const totalOffer = categoryOffer + productOffer;

    // Render the product details page
    res.render('product-details', {
      user: userData,
      product: product,
      quantity: product.quantity,
      totalOffer: totalOffer,
      category: findCategory,
    });
  }catch (error) {
    next(error); // Pass the error to the errorHandler middleware
}
};

module.exports = {
  addToCart,
  getCartPage,
  incrementQuantity,
  decrementQuantity,
  removeFromCart,
  getCheckout,
  selectAddress,
  saveAddress,
  productDetails,
};
