import { useMemo, useState, useEffect, createContext, useContext, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, CircleAlert, Clock3, Leaf, LogOut, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, ShoppingCart, Sprout, Star, Truck, Users, Wallet, X } from 'lucide-react';
import {
  ProductCategory,
  getGetAdminOrdersQueryKey, getGetAdminProductsQueryKey, getGetAdminUsersQueryKey,
  getGetBulkRequestsQueryKey, getGetMarketplaceStatsQueryKey, getGetMeQueryKey,
  getGetMyOrdersQueryKey, getGetProductQueryKey, getGetProductReviewsQueryKey,
  getGetProductsQueryKey, getHealthCheckQueryKey, setAuthTokenGetter,
  useApproveFarmer, useCheckout, useCreateBulkRequest, useCreateProduct,
  useCreateReview, useDeleteProduct, useGetAdminOrders, useGetAdminProducts,
  useGetAdminUsers, useGetBulkRequests, useGetMarketplaceStats, useGetMe,
  useGetMyOrders, useGetProduct, useGetProductReviews, useGetProducts,
  useHealthCheck, useLogin, useRegister, useUpdateOrderStatus, useUpdateProduct,
  type BulkRequestInput, type CheckoutInput, type Order, type Product, type ProductCategory as ProductCategoryType, type ProductInput, type ProductUpdate, type ReviewInput, type User,
} from '@workspace/api-client-react';
import './index.css';

setAuthTokenGetter(() => localStorage.getItem('farmdirect_token'));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000 } } });

type CartLine = { product: Product; quantity: number };
const CartContext = createContext<{ cart: CartLine[]; add: (p: Product, quantity?: number) => void; change: (id: number, quantity: number) => void; clear: () => void }>({ cart: [], add: () => {}, change: () => {}, clear: () => {} });
const NoticeContext = createContext<(message: string) => void>(() => {});
const useNotice = () => useContext(NoticeContext);
const categories = Object.values(ProductCategory);
const formatINR = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const niceDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const imgFallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"%3E%3Crect width="700" height="500" fill="%23e9eddf"/%3E%3Ccircle cx="350" cy="250" r="110" fill="%23c1d1b5"/%3E%3Cpath d="M350 152c-40-45-102-40-118 8 31 21 75 23 118-8zm5 3c32-54 93-53 118-18-21 30-64 43-118 18z" fill="%234e7955"/%3E%3Ccircle cx="350" cy="273" r="62" fill="%23d7834b"/%3E%3C/svg%3E';

function useCurrentUser() {
  const token = localStorage.getItem('farmdirect_token');
  return useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
}

function AppRoot() {
  const [cart, setCart] = useState<CartLine[]>(() => {
    try { return JSON.parse(localStorage.getItem('farmdirect_cart') || '[]') as CartLine[]; } catch { return []; }
  });
  const [notice, setNotice] = useState('');
  useEffect(() => { localStorage.setItem('farmdirect_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const add = (product: Product, quantity = 1) => {
    setCart((current) => {
      const found = current.find((line) => line.product.id === product.id);
      return found ? current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + quantity } : line) : [...current, { product, quantity }];
    });
    setNotice(`${product.name} added to your basket`);
  };
  const change = (id: number, quantity: number) => setCart((current) => quantity <= 0 ? current.filter((line) => line.product.id !== id) : current.map((line) => line.product.id === id ? { ...line, quantity } : line));
  const clear = () => setCart([]);
  return <CartContext.Provider value={{ cart, add, change, clear }}><NoticeContext.Provider value={setNotice}><AppFrame />{notice && <div className="toast-message" role="status" data-testid="status-toast">{notice}</div>}</NoticeContext.Provider></CartContext.Provider>;
}

function AppFrame() {
  const userQuery = useCurrentUser();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000 } });
  const [menuOpen, setMenuOpen] = useState(false);
  const [location, navigate] = useLocation();
  const { cart } = useContext(CartContext);
  const user = userQuery.data;
  const links = [
    { href: '/', text: 'Marketplace', show: true },
    { href: '/buyer/orders', text: 'My orders', show: user?.role === 'buyer' || user?.role === 'business' },
    { href: '/business/bulk', text: 'Bulk buying', show: user?.role === 'business' },
    { href: '/farmer', text: 'Farm dashboard', show: user?.role === 'farmer' },
    { href: '/admin', text: 'Admin', show: user?.role === 'admin' },
  ].filter((link) => link.show);
  const logout = () => { localStorage.removeItem('farmdirect_token'); queryClient.clear(); navigate('/'); window.location.reload(); };
  return <div className="app-shell">
    <header className="topbar">
      <div className="container-wide topbar-inner">
        <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Sprout size={21} /></span>farmdirect</Link>
        <nav className={`main-nav ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
          {links.map((item) => <Link key={item.href} href={item.href} className={location === item.href ? 'active' : ''} data-testid={`link-nav-${item.text.toLowerCase().replaceAll(' ', '-')}`}>{item.text}</Link>)}
          {user && <span className="subtle" data-testid="text-nav-user">Hi, {user.name.split(' ')[0]}</span>}
        </nav>
        <div className="top-actions">
          {user ? <button className="button button-soft" onClick={logout} data-testid="button-sign-out"><LogOut size={15} /> Sign out</button> : <Link className="button button-soft" href="/login" data-testid="link-sign-in">Sign in</Link>}
          <Link href="/cart" className="icon-button" aria-label="Basket" data-testid="link-cart"><ShoppingCart size={18} />{cart.length > 0 && <span className="cart-count" data-testid="text-cart-count">{cart.reduce((n, line) => n + line.quantity, 0)}</span>}</Link>
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} data-testid="button-mobile-menu">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
        </div>
      </div>
    </header>
    <main><Switch>
      <Route path="/" component={HomePage} />
      <Route path="/products/:id" component={ProductPage} />
      <Route path="/cart" component={CartPage} />
      <Route path="/checkout" component={CheckoutPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/farmer"><Protected role="farmer"><FarmerPage /></Protected></Route>
      <Route path="/buyer/orders"><Protected roles={['buyer', 'business']}><BuyerOrdersPage /></Protected></Route>
      <Route path="/business/bulk"><Protected role="business"><BulkPage /></Protected></Route>
      <Route path="/admin"><Protected role="admin"><AdminPage /></Protected></Route>
      <Route component={NotFound} />
    </Switch></main>
    <footer className="footer"><div className="container-wide footer-inner"><div><Link href="/" className="brand" style={{ color: '#f5f1e5' }}><span className="brand-mark"><Sprout size={21} /></span>farmdirect</Link><p>Good food, closer to home. A fairer way to bring India's harvest to the people who value it.</p></div><div><div style={{ display: 'flex', gap: 7, alignItems: 'center', color: '#d7e6d8', fontSize: 12 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: health.isError ? '#d38362' : '#9fc79f' }} />{health.isError ? 'Marketplace connection unavailable' : 'Local harvest, ready to order'}</div><p>Cash on delivery · Verified growers · Freshly listed</p></div></div></footer>
  </div>;
}

function Protected({ children, role, roles }: { children: ReactNode; role?: User['role']; roles?: User['role'][] }) {
  const userQuery = useCurrentUser();
  const [, navigate] = useLocation();
  useEffect(() => { if (!localStorage.getItem('farmdirect_token')) navigate('/login'); }, [navigate]);
  if (!localStorage.getItem('farmdirect_token')) return <LoadingPanel label="Taking you to sign in" />;
  if (userQuery.isLoading) return <LoadingPanel label="Checking your account" />;
  if (userQuery.isError || !userQuery.data) return <ErrorPanel error={userQuery.error} retry={() => userQuery.refetch()} />;
  if ((role && userQuery.data.role !== role) || (roles && !roles.includes(userQuery.data.role))) return <div className="page"><div className="container-wide"><Empty icon={<ShieldCheck size={28} />} title="This area is for another account" text="Sign in with the account type that can use this workspace." action={<Link className="button button-primary" href="/">Back to marketplace</Link>} /></div></div>;
  return <>{children}</>;
}

function LoadingPanel({ label = 'Loading your marketplace' }: { label?: string }) {
  return <div className="page"><div className="container-wide"><div className="loading-grid">{[0,1,2,3].map((n) => <div key={n} className="skeleton" />)}</div><p className="subtle" data-testid="status-loading">{label}</p></div></div>;
}
function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="error-box" data-testid="status-error"><span><CircleAlert size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} />{errorText(error)}</span><button className="button button-outline" onClick={retry} data-testid="button-retry">Try again</button></div>;
}
function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state" data-testid="state-empty"><div style={{ color: '#78927b' }}>{icon}</div><h3>{title}</h3><p style={{ margin: '0 auto 16px', maxWidth: 420 }}>{text}</p>{action}</div>;
}

function HomePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(category ? { category: category as ProductCategoryType } : {}) }), [search, category]);
  const products = useGetProducts(params, { query: { queryKey: getGetProductsQueryKey(params) } });
  const { add } = useContext(CartContext);
  const [, navigate] = useLocation();
  return <div className="page" style={{ paddingTop: 0 }}>
    <div className="container-wide">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">A better way to buy your daily harvest</span>
          <h1>Fresh From Farmers,<br />Directly to You</h1>
          <p>Get the freshest vegetables, fruits, grains, and specialty items straight from local farms. No middlemen, fair prices, maximum freshness.</p>
          <div className="hero-actions"><a href="#market" className="button button-primary" data-testid="link-explore-harvest">Browse Products <ArrowRight size={16} /></a><Link href="/register?role=farmer" className="text-link" data-testid="link-grow-with-us">Sell Products <ArrowRight size={14} /></Link></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="hero-visual">
          <div className="sun-orb" /><div className="field-line field-one" /><div className="field-line field-two" /><div className="field-line field-three" />
          <span className="produce-shape pumpkin" /><span className="produce-shape tomato" /><span className="produce-shape leaf-shape" /><span className="produce-shape squash" />
          <div className="farm-note">JUST PICKED<br /><b>NEAR YOU</b></div>
        </div><div className="hero-stamp">GOOD FOOD<br />GROWN CLOSE<br />TO HOME</div></div>
      </section>
      <section id="market">
        <div className="section-head"><div><span className="eyebrow">The marketplace</span><h2>Good things in season</h2></div><span className="subtle">Straight from trusted farms</span></div>
        <div className="toolbar">
          <label className="searchbox"><Search size={17} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find tomatoes, mangoes, rice…" aria-label="Search produce" data-testid="input-product-search" /></label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" data-testid="select-category"><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          {category && <button className="button button-soft" onClick={() => setCategory('')} data-testid="button-clear-category">Clear filter <X size={14} /></button>}
        </div>
        <div className="category-quick-filters" aria-label="Popular categories">
          <span>Popular categories</span>
          <button className={!category ? 'category-chip active' : 'category-chip'} onClick={() => setCategory('')} data-testid="button-category-all">All produce</button>
          {categories.map((item) => <button key={item} className={category === item ? 'category-chip active' : 'category-chip'} onClick={() => setCategory(item)} data-testid={`button-category-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</button>)}
        </div>
        {products.isLoading ? <div className="loading-grid">{[1,2,3,4].map((n) => <div key={n} className="skeleton" />)}</div> : products.isError ? <ErrorPanel error={products.error} retry={() => products.refetch()} /> :
          products.data?.length ? <div className="product-grid">{products.data.map((product) => <ProductCard key={product.id} product={product} onAdd={() => add(product)} />)}</div> :
          <Empty icon={<Leaf size={30} />} title="Nothing on the stall just yet" text="Try another search or category. New harvests are added regularly." action={search || category ? <button onClick={() => { setSearch(''); setCategory(''); }} className="button button-outline" data-testid="button-reset-filters">Reset filters</button> : undefined} />}
      </section>
      <section className="trust-band" aria-label="Why FarmDirect">
        <div className="trust-item"><BadgeCheck /><div><strong>Know who grew it</strong><span>Meet verified farmers and buy with confidence.</span></div></div>
        <div className="trust-item"><Truck /><div><strong>Harvested for your order</strong><span>Less time in transit, more goodness on your plate.</span></div></div>
        <div className="trust-item"><Wallet /><div><strong>Pay when it arrives</strong><span>Simple cash on delivery. No surprises at checkout.</span></div></div>
      </section>
      <section className="how-section" aria-labelledby="how-title">
        <div className="section-head"><div><span className="eyebrow">Simple by design</span><h2 id="how-title">How FarmDirect works</h2></div><span className="subtle">A shorter path from farm to kitchen</span></div>
        <div className="how-grid">
          <article className="how-card"><span className="how-number">01</span><Sprout size={22} /><h3>Farmers list the harvest</h3><p>Local growers share what's fresh, where it was grown, and how much is ready.</p></article>
          <article className="how-card"><span className="how-number">02</span><ShoppingBag size={22} /><h3>You choose what you need</h3><p>Browse by category, compare prices, and place your order directly with a grower.</p></article>
          <article className="how-card"><span className="how-number">03</span><Truck size={22} /><h3>Fresh produce comes to you</h3><p>Follow your order from confirmation to delivery, then pay by cash on delivery.</p></article>
        </div>
      </section>
      <section className="season-card">
        <div><span className="eyebrow">For growing businesses</span><h2 className="serif">Your kitchen runs on good sourcing.</h2><p>Buy in volume from growers who know their produce. Tell us what you need, and build a dependable supply.</p><Link className="button button-primary" href="/business/bulk" data-testid="link-business-bulk">Explore bulk buying <ArrowRight size={15} /></Link></div>
        <div className="season-graphic"><span>FIELD<br />NOTES</span><div className="leaf-illustration" /></div>
      </section>
    </div>
  </div>;
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  return <article className="product-card" data-testid={`card-product-${product.id}`}>
    <Link href={`/products/${product.id}`} className="product-image" data-testid={`link-product-${product.id}`}><img src={product.imageUrl || imgFallback} onError={(e) => { e.currentTarget.src = imgFallback; }} alt={product.name} data-testid={`img-product-${product.id}`} /><span className="pill">{product.category}</span>{product.featured && <span className="featured-pill">Featured</span>}</Link>
    <div className="product-content"><div className="product-meta"><span><MapPin size={11} style={{ verticalAlign: 'middle' }} /> {product.location}</span>{product.verifiedFarmer && <span title="Verified grower"><BadgeCheck size={14} color="#538057" /></span>}</div>
      <Link href={`/products/${product.id}`} className="product-name" data-testid={`text-product-name-${product.id}`}>{product.name}</Link>
      <div className="product-meta"><span>by {product.farmerName}</span><span className="rating"><Star size={12} fill="currentColor" /> {product.rating.toFixed(1)} ({product.reviewCount})</span></div>
      <div className="product-availability" data-testid={`text-product-availability-${product.id}`}>{product.quantity} {product.unit} available</div>
      <div className="product-bottom"><span className="price" data-testid={`text-product-price-${product.id}`}>{formatINR(product.price)} <small>/ {product.unit}</small></span><button className="mini-add" onClick={onAdd} aria-label={`Add ${product.name} to basket`} data-testid={`button-add-product-${product.id}`}><Plus size={18} /></button></div>
    </div>
  </article>;
}

function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const product = useGetProduct(productId, { query: { queryKey: getGetProductQueryKey(productId) } });
  const reviews = useGetProductReviews(productId, { query: { queryKey: getGetProductReviewsQueryKey(productId) } });
  const { add } = useContext(CartContext);
  const [qty, setQty] = useState(1);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const createReview = useCreateReview();
  const notify = useNotice();
  const qc = useQueryClient();
  const user = useCurrentUser();
  if (product.isLoading) return <LoadingPanel />;
  if (product.isError || !product.data) return <div className="page"><div className="container-wide"><ErrorPanel error={product.error} retry={() => product.refetch()} /></div></div>;
  const p = product.data;
  const onReview = (e: FormEvent) => {
    e.preventDefault();
    const orderId = Number((e.currentTarget as HTMLFormElement).elements.namedItem('orderId') && ((e.currentTarget as HTMLFormElement).elements.namedItem('orderId') as HTMLInputElement).value);
    if (!orderId || !comment.trim()) { notify('Add the delivered order number and your review.'); return; }
    const data: ReviewInput = { productId, orderId, rating, comment: comment.trim() };
    createReview.mutate({ data }, { onSuccess: () => { setComment(''); qc.invalidateQueries({ queryKey: getGetProductReviewsQueryKey(productId) }); qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) }); notify('Thank you for sharing your experience.'); } });
  };
  return <div className="page"><div className="container-wide">
    <Link href="/" className="text-link" data-testid="link-back-marketplace"><ArrowLeft size={14} /> Back to the marketplace</Link>
    <section className="detail-grid" style={{ marginTop: 24 }}>
      <img className="detail-image" src={p.imageUrl || imgFallback} onError={(e) => { e.currentTarget.src = imgFallback; }} alt={p.name} data-testid="img-product-detail" />
      <div><span className="eyebrow">{p.category} · {p.location}</span><h1 className="page-title" data-testid="text-product-detail-name">{p.name}</h1>
        <div className="product-meta" style={{ justifyContent: 'flex-start', gap: 14, margin: '12px 0' }}><span>Grown by {p.farmerName}</span>{p.verifiedFarmer && <span className="pill"><BadgeCheck size={13} /> Verified grower</span>}<span className="rating"><Star size={13} fill="currentColor" /> {p.rating.toFixed(1)} · {p.reviewCount} reviews</span></div>
        <div className="detail-price">{formatINR(p.price)} <span style={{ font: '500 14px DM Sans', color: '#879186' }}>/ {p.unit}</span></div>
        <p className="subtle" style={{ lineHeight: 1.8 }} data-testid="text-product-description">{p.description}</p>
        <p className="subtle">Available: {p.quantity} {p.unit} · Bulk orders from {p.minBulkQuantity} {p.unit}</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 24, flexWrap: 'wrap' }}><div className="qty-control"><button aria-label="Decrease quantity" onClick={() => setQty(Math.max(1, qty - 1))} data-testid="button-quantity-minus"><Minus size={14} /></button><span data-testid="text-quantity">{qty}</span><button aria-label="Increase quantity" onClick={() => setQty(Math.min(p.quantity, qty + 1))} data-testid="button-quantity-plus"><Plus size={14} /></button></div><button className="button button-primary" onClick={() => add(p, qty)} data-testid="button-add-detail-cart"><ShoppingBag size={16} /> Add to basket · {formatINR(p.price * qty)}</button></div>
        {user.data?.role === 'business' && <Link className="text-link" href="/business/bulk" style={{ marginTop: 17 }} data-testid="link-request-bulk">Need a larger quantity? Make a bulk request <ArrowRight size={14} /></Link>}
      </div>
    </section>
    <section style={{ marginTop: 64 }}><div className="section-head"><div><span className="eyebrow">From the community</span><h2>Reviews from real buyers</h2></div></div>
      {reviews.isLoading ? <div className="skeleton" style={{ height: 110 }} /> : reviews.isError ? <ErrorPanel error={reviews.error} retry={() => reviews.refetch()} /> : reviews.data?.length ? <div>{reviews.data.map((review) => <div className="panel review-row" key={review.id} data-testid={`card-review-${review.id}`} style={{ marginBottom: 12, padding: 20 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{review.buyerName}</strong><span className="rating"><Star size={13} fill="currentColor" /> {review.rating}</span></div><p style={{ color: '#637268', fontSize: 13, lineHeight: 1.7 }}>{review.comment}</p><span className="subtle" style={{ fontSize: 11 }}>{niceDate(review.createdAt)}</span></div>)}</div> : <Empty icon={<Star size={28} />} title="Be the first to leave a note" text="Your experience helps other shoppers make a good choice." />}
      {user.data && <form onSubmit={onReview} className="panel" style={{ marginTop: 18 }}><h3>Share a review</h3><p className="subtle">Reviews are linked to completed orders.</p><div className="form-grid"><div className="field"><label htmlFor="review-order">Delivered order number</label><input className="input" id="review-order" name="orderId" type="number" min="1" placeholder="For example, 1042" data-testid="input-review-order" /></div><div className="field"><label htmlFor="review-rating">Your rating</label><select id="review-rating" className="input" value={rating} onChange={(e) => setRating(Number(e.target.value))} data-testid="select-review-rating">{[5,4,3,2,1].map((n) => <option value={n} key={n}>{n} out of 5</option>)}</select></div><div className="field full"><label htmlFor="review-comment">What did you think?</label><textarea className="textarea" id="review-comment" value={comment} onChange={(e) => setComment(e.target.value)} required data-testid="input-review-comment" /></div></div><button className="button button-primary" style={{ marginTop: 14 }} disabled={createReview.isPending} data-testid="button-submit-review">{createReview.isPending ? 'Sending…' : 'Post review'}</button>{createReview.isError && <p className="error-text">{errorText(createReview.error)}</p>}</form>}
    </section>
  </div></div>;
}

function CartPage() {
  const { cart, change } = useContext(CartContext);
  const total = cart.reduce((n, line) => n + line.product.price * line.quantity, 0);
  return <div className="page"><div className="container-wide"><span className="eyebrow">Your basket</span><h1 className="page-title">A good choice.</h1><p className="subtle">Everything is paid for when it reaches your door.</p>
    {cart.length === 0 ? <Empty icon={<ShoppingBag size={30} />} title="Your basket is taking a breather" text="Find something fresh at the marketplace and it will be right here." action={<Link className="button button-primary" href="/" data-testid="link-shop-products">Shop the harvest <ArrowRight size={15} /></Link>} /> : <div className="cart-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 22, alignItems: 'start', marginTop: 24 }}>
      <div>{cart.map((line) => <div className="panel cart-line" key={line.product.id} style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }} data-testid={`row-cart-${line.product.id}`}><img src={line.product.imageUrl || imgFallback} onError={(e) => { e.currentTarget.src = imgFallback; }} alt="" style={{ width: 84, height: 76, objectFit: 'cover', borderRadius: 12 }} /><div style={{ flex: 1 }}><Link href={`/products/${line.product.id}`} className="product-name">{line.product.name}</Link><div className="subtle">{formatINR(line.product.price)} / {line.product.unit}</div></div><div className="qty-control"><button onClick={() => change(line.product.id, line.quantity - 1)} aria-label={`Remove one ${line.product.name}`} data-testid={`button-cart-minus-${line.product.id}`}><Minus size={13} /></button><span>{line.quantity}</span><button onClick={() => change(line.product.id, line.quantity + 1)} aria-label={`Add one ${line.product.name}`} data-testid={`button-cart-plus-${line.product.id}`}><Plus size={13} /></button></div><strong>{formatINR(line.product.price * line.quantity)}</strong></div>)}</div>
      <aside className="panel"><h3>Order summary</h3><div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #eee9de' }}><span className="subtle">Produce subtotal</span><strong>{formatINR(total)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 0' }}><strong>Total</strong><strong className="price">{formatINR(total)}</strong></div><p className="subtle" style={{ fontSize: 11 }}>Cash on delivery. No online payment needed.</p><Link href="/checkout" className="button button-primary" style={{ width: '100%', marginTop: 8 }} data-testid="button-proceed-checkout">Continue to delivery <ArrowRight size={15} /></Link></aside>
    </div>}
  </div></div>;
}

function CheckoutPage() {
  const { cart, clear } = useContext(CartContext);
  const [, navigate] = useLocation();
  const [address, setAddress] = useState('');
  const [done, setDone] = useState<Order | null>(null);
  const checkout = useCheckout();
  const qc = useQueryClient();
  const notify = useNotice();
  const user = useCurrentUser();
  const total = cart.reduce((n, line) => n + line.product.price * line.quantity, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cart.length) { notify('Add some produce before checkout.'); return; }
    const data: CheckoutInput = { items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })), deliveryAddress: address.trim(), paymentMethod: 'cod' };
    checkout.mutate({ data }, { onSuccess: (order) => { setDone(order); clear(); qc.invalidateQueries({ queryKey: getGetMyOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getGetProductsQueryKey() }); } });
  };
  if (done) return <div className="page"><div className="container-wide"><div className="panel success-panel" style={{ maxWidth: 640, margin: '35px auto', textAlign: 'center', padding: 42 }}><span className="success-icon"><Check size={26} /></span><span className="eyebrow">Order placed</span><h1 className="page-title">Your harvest is on its way.</h1><p className="subtle">Order #{done.id} · {formatINR(done.total)} · Cash on delivery</p><p className="subtle">{done.deliveryAddress}</p><Link className="button button-primary" href="/buyer/orders" data-testid="link-view-orders">Track your order <ArrowRight size={15} /></Link></div></div></div>;
  return <div className="page"><div className="container-wide"><span className="eyebrow">Almost there</span><h1 className="page-title">Where should it arrive?</h1>
    {!user.data && <div className="error-box" style={{ margin: '18px 0' }}>Sign in before placing your order. <Link className="button button-primary" href="/login" data-testid="link-checkout-login">Sign in</Link></div>}
    {cart.length === 0 ? <Empty icon={<ShoppingCart size={28} />} title="Your basket is empty" text="Choose your produce first and come back here to arrange delivery." action={<Link className="button button-primary" href="/">Browse produce</Link>} /> : <form className="checkout-grid" onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 22, marginTop: 25, alignItems: 'start' }}>
      <section className="panel"><h2>Delivery details</h2><div className="field"><label htmlFor="delivery-address">Full delivery address</label><textarea className="textarea" id="delivery-address" value={address} onChange={(e) => setAddress(e.target.value)} required placeholder="House / building, street, area, city, PIN code" data-testid="input-delivery-address" /></div><div className="delivery-pay"><Wallet size={20} /><div><strong>Cash on delivery</strong><span>Pay in cash when your order arrives. Payments are COD only.</span></div></div></section>
      <aside className="panel"><h3>Order summary</h3>{cart.map((line) => <div key={line.product.id} className="summary-line"><span>{line.quantity} × {line.product.name}</span><strong>{formatINR(line.product.price * line.quantity)}</strong></div>)}<div className="summary-total"><span>Total due on delivery</span><strong>{formatINR(total)}</strong></div><button className="button button-primary" type="submit" disabled={checkout.isPending || !user.data} style={{ width: '100%', marginTop: 16 }} data-testid="button-place-order">{checkout.isPending ? 'Placing your order…' : 'Place order'}</button>{checkout.isError && <p className="form-error" data-testid="status-checkout-error">{errorText(checkout.error)}</p>}</aside>
    </form>}
  </div></div>;
}

function LoginPage() {
  const login = useLogin();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const signIn = (e: FormEvent) => {
    e.preventDefault(); setError('');
    login.mutate({ data: { email, password } }, { onSuccess: (auth) => { localStorage.setItem('farmdirect_token', auth.token); qc.setQueryData(getGetMeQueryKey(), auth.user); navigate(auth.user.role === 'farmer' ? '/farmer' : auth.user.role === 'admin' ? '/admin' : '/'); }, onError: (err) => setError(errorText(err)) });
  };
  const demos = [{ role: 'Admin', email: 'admin@farmdirect.com', password: 'admin123' }, { role: 'Farmer', email: 'farmer@farmdirect.com', password: 'farmer123' }, { role: 'Buyer', email: 'buyer@farmdirect.com', password: 'buyer123' }];
  return <div className="auth-wrap"><div className="auth-card"><Link className="text-link" href="/" data-testid="link-auth-back"><ArrowLeft size={14} /> Marketplace</Link><span className="eyebrow" style={{ display: 'block', marginTop: 25 }}>Welcome back</span><h1>Good to have you here.</h1><p className="subtle">Sign in to see what is growing.</p><form onSubmit={signIn} className="auth-form"><div className="field"><label htmlFor="login-email">Email address</label><input className="input" id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="input-login-email" /></div><div className="field" style={{ marginTop: 13 }}><label htmlFor="login-password">Password</label><input className="input" id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-testid="input-login-password" /></div>{error && <p className="form-error" data-testid="status-login-error">{error}</p>}<button className="button button-primary" style={{ width: '100%', marginTop: 18 }} disabled={login.isPending} data-testid="button-login">{login.isPending ? 'Signing in…' : 'Sign in'}</button></form><div className="demo-accounts"><h3>Try a demo account</h3>{demos.map((demo) => <div className="demo-row" key={demo.email}><span><strong>{demo.role}</strong><br />{demo.email}</span><button className="button button-soft" onClick={() => { setEmail(demo.email); setPassword(demo.password); }} data-testid={`button-demo-${demo.role.toLowerCase()}`}>Quick fill</button></div>)}</div><p className="auth-foot">New to FarmDirect? <Link href="/register" className="text-link" data-testid="link-register">Create an account <ArrowRight size={13} /></Link></p></div></div>;
}

function RegisterPage() {
  const register = useRegister();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const initialRole = new URLSearchParams(window.location.search).get('role');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: (initialRole === 'farmer' ? 'farmer' : 'buyer') as 'buyer'|'farmer'|'business', location: '', organization: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); register.mutate({ data: { ...form, organization: form.organization || undefined } }, { onSuccess: (auth) => { localStorage.setItem('farmdirect_token', auth.token); qc.setQueryData(getGetMeQueryKey(), auth.user); navigate(auth.user.role === 'farmer' ? '/farmer' : '/'); }, onError: (err) => setError(errorText(err)) }); };
  return <div className="auth-wrap"><div className="auth-card"><Link className="text-link" href="/" data-testid="link-register-back"><ArrowLeft size={14} /> Marketplace</Link><span className="eyebrow" style={{ display: 'block', marginTop: 25 }}>Join the growing community</span><h1>Let's get started.</h1><p className="subtle">One account for a more direct food system.</p><form onSubmit={submit} style={{ marginTop: 20 }}><div className="field"><label htmlFor="reg-role">I am joining as</label><select className="input" id="reg-role" value={form.role} onChange={(e) => set('role', e.target.value)} data-testid="select-register-role"><option value="buyer">A household buyer</option><option value="farmer">A farmer / grower</option><option value="business">A restaurant or business</option></select></div><div className="form-grid" style={{ marginTop: 13 }}><div className="field"><label htmlFor="reg-name">Your name</label><input id="reg-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required data-testid="input-register-name" /></div><div className="field"><label htmlFor="reg-location">City or village</label><input id="reg-location" className="input" value={form.location} onChange={(e) => set('location', e.target.value)} required data-testid="input-register-location" /></div><div className="field full"><label htmlFor="reg-email">Email address</label><input id="reg-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required data-testid="input-register-email" /></div><div className="field full"><label htmlFor="reg-password">Password · at least 6 characters</label><input id="reg-password" className="input" type="password" minLength={6} value={form.password} onChange={(e) => set('password', e.target.value)} required data-testid="input-register-password" /></div>{form.role === 'business' && <div className="field full"><label htmlFor="reg-org">Business / organization name</label><input id="reg-org" className="input" value={form.organization} onChange={(e) => set('organization', e.target.value)} data-testid="input-register-organization" /></div>}</div>{error && <p className="form-error">{error}</p>}<button className="button button-primary" style={{ width: '100%', marginTop: 18 }} disabled={register.isPending} data-testid="button-register">{register.isPending ? 'Creating your account…' : 'Create account'}</button></form><p className="auth-foot">Already with us? <Link href="/login" className="text-link" data-testid="link-login">Sign in</Link></p></div></div>;
}

function BuyerOrdersPage() {
  const orders = useGetMyOrders({ query: { queryKey: getGetMyOrdersQueryKey() } });
  return <div className="page"><div className="container-wide"><span className="eyebrow">Your farm-to-door journey</span><h1 className="page-title">Orders & deliveries</h1><p className="subtle">Keep an eye on the good things heading your way.</p>{orders.isLoading ? <LoadingPanel /> : orders.isError ? <ErrorPanel error={orders.error} retry={() => orders.refetch()} /> : orders.data?.length ? <div style={{ marginTop: 25 }}>{orders.data.map((order) => <OrderCard key={order.id} order={order} />)}</div> : <Empty icon={<PackageCheck size={28} />} title="No orders yet" text="Your first delivery starts with something fresh from the marketplace." action={<Link className="button button-primary" href="/">Browse the harvest</Link>} />}</div></div>;
}

function OrderCard({ order, farmer = false }: { order: Order; farmer?: boolean }) {
  const update = useUpdateOrderStatus();
  const qc = useQueryClient();
  const notify = useNotice();
  const possible = farmer ? (order.status === 'Pending' ? ['Confirmed','Cancelled'] : order.status === 'Confirmed' ? ['Processing','Cancelled'] : order.status === 'Processing' ? ['Shipped'] : order.status === 'Shipped' ? ['Delivered'] : []) : [];
  const updateStatus = (status: string) => update.mutate({ id: order.id, data: { status: status as 'Confirmed'|'Processing'|'Shipped'|'Delivered'|'Cancelled' } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetMyOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminOrdersQueryKey() }); notify(`Order #${order.id} updated to ${status}.`); } });
  return <article className="panel order-card" data-testid={`card-order-${order.id}`}><div className="order-top"><div><span className="eyebrow">Order #{order.id}</span><h3 style={{ margin: '5px 0' }}>{farmer ? `For ${order.buyerName}` : `Placed ${niceDate(order.createdAt)}`}</h3><span className="subtle">{farmer ? `Deliver to ${order.deliveryAddress}` : `Delivering to ${order.deliveryAddress}`}</span></div><div style={{ textAlign: 'right' }}><span className="status-tag" data-testid={`status-order-${order.id}`}>{order.status}</span><div className="price" style={{ marginTop: 9 }}>{formatINR(order.total)}</div><small className="subtle">Cash on delivery</small></div></div><div className="order-items">{order.items.map((item) => <div key={item.id} className="order-item"><img src={item.imageUrl || imgFallback} onError={(e) => { e.currentTarget.src = imgFallback; }} alt="" /><span>{item.productName} · {item.quantity} × {formatINR(item.unitPrice)}</span>{!farmer && order.status === 'Delivered' && <Link className="text-link" href={`/products/${item.productId}`} data-testid={`link-review-item-${item.id}`}>Review <ArrowRight size={12} /></Link>}</div>)}</div>{possible.length > 0 && <div className="order-actions">{possible.map((status) => <button key={status} className={`button ${status === 'Cancelled' ? 'button-danger' : 'button-soft'}`} disabled={update.isPending} onClick={() => updateStatus(status)} data-testid={`button-order-${status.toLowerCase()}-${order.id}`}>{update.isPending ? 'Saving…' : status}</button>)}</div>}{update.isError && <p className="form-error">{errorText(update.error)}</p>}</article>;
}

function FarmerPage() {
  const user = useCurrentUser();
  const products = useGetProducts({}, { query: { queryKey: getGetProductsQueryKey({}) } });
  const orders = useGetMyOrders({ query: { queryKey: getGetMyOrdersQueryKey() } });
  const qc = useQueryClient();
  const notify = useNotice();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const owned = products.data?.filter((p) => p.farmerId === user.data?.id) || [];
  const myOrders = orders.data?.filter((order) => order.items.some((item) => item.farmerId === user.data?.id)) || [];
  const earnings = myOrders.reduce((total, order) => total + (order.status === 'Delivered' ? order.items.filter((item) => item.farmerId === user.data?.id).reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) : 0), 0);
  const [form, setForm] = useState({ name: '', category: 'Vegetables' as ProductCategoryType, price: '', quantity: '', unit: 'kg', location: user.data?.location || '', description: '', imageUrl: '', minBulkQuantity: '1', featured: false });
  const resetForm = () => { setEditing(null); setForm({ name: '', category: 'Vegetables', price: '', quantity: '', unit: 'kg', location: user.data?.location || '', description: '', imageUrl: '', minBulkQuantity: '1', featured: false }); setShowForm(false); };
  const startEdit = (p: Product) => { setEditing(p); setForm({ name: p.name, category: p.category, price: String(p.price), quantity: String(p.quantity), unit: p.unit, location: p.location, description: p.description, imageUrl: p.imageUrl, minBulkQuantity: String(p.minBulkQuantity), featured: p.featured }); setShowForm(true); };
  const save = (e: FormEvent) => { e.preventDefault(); const data: ProductInput = { name: form.name, category: form.category, price: Number(form.price), quantity: Number(form.quantity), unit: form.unit, location: form.location, description: form.description, imageUrl: form.imageUrl || undefined, minBulkQuantity: Number(form.minBulkQuantity), featured: form.featured }; const onSuccess = () => { qc.invalidateQueries({ queryKey: getGetProductsQueryKey({}) }); resetForm(); notify(editing ? 'Your listing is updated.' : 'Your harvest is now listed.'); }; if (editing) update.mutate({ id: editing.id, data: data as ProductUpdate }, { onSuccess }); else create.mutate({ data }, { onSuccess }); };
  const deleteListing = (p: Product) => { if (window.confirm(`Remove ${p.name} from your listings?`)) remove.mutate({ id: p.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProductsQueryKey({}) }); notify('Listing removed.'); } }); };
  const pending = create.isPending || update.isPending;
  return <div className="page"><div className="container-wide">
    <div className="farmer-welcome"><div><span className="eyebrow">Grower workspace</span><h1 className="page-title">Good morning, {user.data?.name.split(' ')[0]}.</h1><p className="subtle">Your farm, your orders, all in one place.</p></div><button className="button button-primary" onClick={() => { setShowForm(!showForm); setEditing(null); }} data-testid="button-add-listing"><Plus size={15} /> Add a listing</button></div>
     <div className="dashboard-grid farmer-dashboard-grid"><div className="metric"><span className="metric-label">Active listings</span><div className="metric-value" data-testid="metric-listings">{owned.length}</div></div><div className="metric"><span className="metric-label">Orders to fulfil</span><div className="metric-value" data-testid="metric-farmer-orders">{myOrders.filter((o) => !['Delivered','Cancelled'].includes(o.status)).length}</div></div><div className="metric"><span className="metric-label">Paid earnings</span><div className="metric-value" style={{ fontSize: 22 }} data-testid="metric-farmer-earnings">{formatINR(earnings)}</div></div><div className="metric"><span className="metric-label">Verified status</span><div className="metric-value" style={{ fontSize: 20, marginTop: 15 }}>{user.data?.verified ? 'Verified grower' : 'Under review'}</div></div><div className="metric"><span className="metric-label">Location</span><div className="metric-value" style={{ fontSize: 19, marginTop: 15 }}>{user.data?.location}</div></div></div>
    {!user.data?.verified && <div className="notice-banner"><ShieldCheck size={18} /><span>Your grower profile is being reviewed. Your listings are visible while verification is pending.</span></div>}
    {showForm && <form className="panel listing-form" onSubmit={save} style={{ margin: '22px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>{editing ? 'Edit your listing' : 'List a fresh harvest'}</h2><button type="button" className="icon-button" onClick={resetForm} aria-label="Close listing form"><X size={16} /></button></div><div className="form-grid"><div className="field"><label htmlFor="listing-name">Produce name</label><input id="listing-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-listing-name" /></div><div className="field"><label htmlFor="listing-category">Category</label><select id="listing-category" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ProductCategoryType })} data-testid="select-listing-category">{categories.map((c) => <option key={c}>{c}</option>)}</select></div><div className="field"><label htmlFor="listing-price">Price per unit (₹)</label><input id="listing-price" className="input" type="number" min=".01" step=".01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required data-testid="input-listing-price" /></div><div className="field"><label htmlFor="listing-quantity">Available quantity</label><input id="listing-quantity" className="input" type="number" min=".01" step=".01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required data-testid="input-listing-quantity" /></div><div className="field"><label htmlFor="listing-unit">Unit</label><input id="listing-unit" className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required data-testid="input-listing-unit" /></div><div className="field"><label htmlFor="listing-bulk-min">Minimum bulk quantity</label><input id="listing-bulk-min" className="input" type="number" min="1" value={form.minBulkQuantity} onChange={(e) => setForm({ ...form, minBulkQuantity: e.target.value })} required data-testid="input-listing-bulk-min" /></div><div className="field"><label htmlFor="listing-location">Location</label><input id="listing-location" className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required data-testid="input-listing-location" /></div><div className="field"><label htmlFor="listing-image">Image URL (optional)</label><input id="listing-image" className="input" type="url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} data-testid="input-listing-image" /></div><div className="field full"><label htmlFor="listing-description">A little about this harvest</label><textarea id="listing-description" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required data-testid="input-listing-description" /></div></div><button className="button button-primary" style={{ marginTop: 15 }} disabled={pending} data-testid="button-save-listing">{pending ? 'Saving…' : editing ? 'Save changes' : 'Publish listing'}</button>{(create.isError || update.isError) && <p className="form-error">{errorText(create.error || update.error)}</p>}</form>}
    <section className="panel"><div className="section-head" style={{ marginTop: 0 }}><div><span className="eyebrow">Your stall</span><h2>Active listings</h2></div></div>{products.isLoading ? <div className="loading-grid"><div className="skeleton" /><div className="skeleton" /></div> : products.isError ? <ErrorPanel error={products.error} retry={() => products.refetch()} /> : owned.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Produce</th><th>Price</th><th>Available</th><th>Reviews</th><th>Actions</th></tr></thead><tbody>{owned.map((p) => <tr key={p.id} data-testid={`row-listing-${p.id}`}><td><strong>{p.name}</strong><br /><span className="subtle">{p.category}</span></td><td>{formatINR(p.price)} / {p.unit}</td><td>{p.quantity} {p.unit}</td><td>{p.rating.toFixed(1)} · {p.reviewCount}</td><td><div className="inline-actions"><button className="button button-soft" onClick={() => startEdit(p)} data-testid={`button-edit-listing-${p.id}`}>Edit</button><button className="button button-danger" onClick={() => deleteListing(p)} disabled={remove.isPending} data-testid={`button-delete-listing-${p.id}`}>Remove</button></div></td></tr>)}</tbody></table></div> : <Empty icon={<Leaf size={27} />} title="Your stall is ready" text="Add your first harvest so local buyers can discover it." action={<button onClick={() => setShowForm(true)} className="button button-primary" data-testid="button-first-listing">List a product</button>} />}</section>
    <section style={{ marginTop: 35 }}><div className="section-head"><div><span className="eyebrow">Keep things moving</span><h2>Recent orders</h2></div></div>{orders.isLoading ? <div className="skeleton" /> : orders.isError ? <ErrorPanel error={orders.error} retry={() => orders.refetch()} /> : myOrders.length ? myOrders.map((order) => <OrderCard order={order} farmer key={order.id} />) : <Empty icon={<PackageCheck size={26} />} title="No orders to pack yet" text="When someone chooses your produce, the order will appear here." />}</section>
  </div></div>;
}

function BulkPage() {
  const products = useGetProducts({}, { query: { queryKey: getGetProductsQueryKey({}) } });
  const requests = useGetBulkRequests({ query: { queryKey: getGetBulkRequestsQueryKey() } });
  const create = useCreateBulkRequest();
  const qc = useQueryClient();
  const notify = useNotice();
  const [form, setForm] = useState({ productId: '', quantity: '', targetPrice: '', notes: '' });
  const submit = (e: FormEvent) => { e.preventDefault(); const data: BulkRequestInput = { productId: Number(form.productId), quantity: Number(form.quantity), targetPrice: form.targetPrice ? Number(form.targetPrice) : null, notes: form.notes }; create.mutate({ data }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetBulkRequestsQueryKey() }); setForm({ productId: '', quantity: '', targetPrice: '', notes: '' }); notify('Your request has been sent to the grower.'); } }); };
  const product = products.data?.find((p) => p.id === Number(form.productId));
  return <div className="page"><div className="container-wide"><span className="eyebrow">For kitchens & shops</span><h1 className="page-title">Source the season, together.</h1><p className="subtle" style={{ maxWidth: 570 }}>Tell growers what your business needs. Share a volume and target price, then work directly with the people growing it.</p>
    <div className="bulk-layout" style={{ display: 'grid', gridTemplateColumns: '1fr .8fr', gap: 22, marginTop: 28, alignItems: 'start' }}><form className="panel" onSubmit={submit}><h2>Make a bulk request</h2><div className="field"><label htmlFor="bulk-product">What are you sourcing?</label><select className="input" id="bulk-product" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required data-testid="select-bulk-product"><option value="">Choose a listed product</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.location}</option>)}</select></div>{product && <div className="bulk-selected"><img src={product.imageUrl || imgFallback} onError={(e) => { e.currentTarget.src = imgFallback; }} alt="" /><span><strong>{product.name}</strong><br />Listed at {formatINR(product.price)} / {product.unit} · min bulk {product.minBulkQuantity} {product.unit}</span></div>}<div className="form-grid" style={{ marginTop: 14 }}><div className="field"><label htmlFor="bulk-quantity">Quantity</label><input className="input" id="bulk-quantity" type="number" min={product?.minBulkQuantity || 1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required data-testid="input-bulk-quantity" /></div><div className="field"><label htmlFor="bulk-target">Target price per unit (optional)</label><input className="input" id="bulk-target" type="number" min="0" step=".01" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} placeholder="₹" data-testid="input-bulk-target-price" /></div><div className="field full"><label htmlFor="bulk-notes">Notes for the grower</label><textarea className="textarea" id="bulk-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} required placeholder="Tell them about delivery dates, grade, or anything else that matters." data-testid="input-bulk-notes" /></div></div>{products.isError && <ErrorPanel error={products.error} retry={() => products.refetch()} />}<button className="button button-primary" style={{ marginTop: 17 }} disabled={create.isPending || products.isLoading} data-testid="button-submit-bulk">{create.isPending ? 'Sending request…' : 'Send request'}</button>{create.isError && <p className="form-error">{errorText(create.error)}</p>}</form>
      <aside className="bulk-aside"><div className="bulk-note"><span className="eyebrow">A direct conversation</span><h2 className="serif">Better supply starts with a clear ask.</h2><p>Every request is shared with the grower, including your quantity, target price, and notes. Your request history stays here.</p><div className="bulk-points"><span><Check size={14} /> No commitment until agreed</span><span><Check size={14} /> Grower-direct sourcing</span><span><Check size={14} /> Cash on delivery orders</span></div></div></aside>
    </div>
    <section style={{ marginTop: 43 }}><div className="section-head"><div><span className="eyebrow">Your sourcing desk</span><h2>Request history</h2></div></div>{requests.isLoading ? <div className="skeleton" /> : requests.isError ? <ErrorPanel error={requests.error} retry={() => requests.refetch()} /> : requests.data?.length ? <div className="table-wrap panel"><table className="data-table"><thead><tr><th>Product</th><th>Quantity</th><th>Target price</th><th>Status</th><th>Requested</th></tr></thead><tbody>{requests.data.map((req) => <tr key={req.id} data-testid={`row-bulk-request-${req.id}`}><td><strong>{req.productName}</strong><br /><span className="subtle">{req.notes}</span></td><td>{req.quantity}</td><td>{req.targetPrice === null ? 'Not set' : formatINR(req.targetPrice)}</td><td><span className="status-tag">{req.status}</span></td><td>{niceDate(req.createdAt)}</td></tr>)}</tbody></table></div> : <Empty icon={<Users size={26} />} title="No requests sent yet" text="Your sourcing requests and grower replies will appear here." />}</section>
  </div></div>;
}

function AdminPage() {
  const stats = useGetMarketplaceStats({ query: { queryKey: getGetMarketplaceStatsQueryKey() } });
  const users = useGetAdminUsers({ query: { queryKey: getGetAdminUsersQueryKey() } });
  const products = useGetAdminProducts({ query: { queryKey: getGetAdminProductsQueryKey() } });
  const orders = useGetAdminOrders({ query: { queryKey: getGetAdminOrdersQueryKey() } });
  const approve = useApproveFarmer();
  const updateStatus = useUpdateOrderStatus();
  const removeListing = useDeleteProduct();
  const qc = useQueryClient();
  const notify = useNotice();
  const approveUser = (id: number, verified: boolean) => approve.mutate({ id, data: { verified } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() }); notify(verified ? 'Farmer approved.' : 'Farmer verification withdrawn.'); } });
  const setStatus = (order: Order, status: 'Confirmed'|'Processing'|'Shipped'|'Delivered'|'Cancelled') => updateStatus.mutate({ id: order.id, data: { status } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminOrdersQueryKey() }); notify(`Order #${order.id} moved to ${status}.`); } });
  const removeProduct = (product: Product) => { if (window.confirm(`Remove ${product.name} from the marketplace?`)) removeListing.mutate({ id: product.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAdminProductsQueryKey() }); qc.invalidateQueries({ queryKey: getGetProductsQueryKey({}) }); qc.invalidateQueries({ queryKey: getGetMarketplaceStatsQueryKey() }); notify(`${product.name} was removed.`); } }); };
  const failed = [stats, users, products, orders].filter((query) => query.isError);
  return <div className="page"><div className="container-wide"><span className="eyebrow">Marketplace operations</span><h1 className="page-title">The whole picture.</h1><p className="subtle">A steady view of growers, listings, and the orders in motion.</p>
    {failed.length > 0 && <ErrorPanel error={failed[0].error} retry={() => { stats.refetch(); users.refetch(); products.refetch(); orders.refetch(); }} />}
    <div className="dashboard-grid">{[{ label: 'Live products', value: stats.data?.productCount }, { label: 'Farmers on FarmDirect', value: stats.data?.farmerCount }, { label: 'Orders placed', value: stats.data?.orderCount }, { label: 'Marketplace revenue', value: stats.data ? formatINR(stats.data.revenue) : undefined }].map((metric) => <div className="metric" key={metric.label} data-testid={`metric-admin-${metric.label.toLowerCase().replaceAll(' ', '-')}`}><span className="metric-label">{metric.label}</span><div className="metric-value">{stats.isLoading ? '—' : metric.value ?? '—'}</div></div>)}</div>
    <section className="panel admin-section"><div className="section-head" style={{ marginTop: 0 }}><div><span className="eyebrow">Trust & safety</span><h2>Farmer approvals</h2></div></div>{users.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : users.data?.filter((u) => u.role === 'farmer').length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Farmer</th><th>Location</th><th>Joined</th><th>Status</th><th>Review</th></tr></thead><tbody>{users.data.filter((u) => u.role === 'farmer').map((farmer) => <tr key={farmer.id} data-testid={`row-farmer-${farmer.id}`}><td><strong>{farmer.name}</strong><br /><span className="subtle">{farmer.email}</span></td><td>{farmer.location}</td><td>{niceDate(farmer.createdAt)}</td><td><span className="status-tag">{farmer.verified ? 'Verified' : 'Awaiting approval'}</span></td><td><button className={`button ${farmer.verified ? 'button-danger' : 'button-primary'}`} onClick={() => approveUser(farmer.id, !farmer.verified)} disabled={approve.isPending} data-testid={`button-approve-farmer-${farmer.id}`}>{approve.isPending ? 'Saving…' : farmer.verified ? 'Suspend' : 'Approve'}</button></td></tr>)}</tbody></table></div> : <Empty icon={<Users size={24} />} title="No growers to review" text="Farmer applications will show up here." />}{approve.isError && <p className="form-error">{errorText(approve.error)}</p>}</section>
     <section className="panel admin-section"><div className="section-head" style={{ marginTop: 0 }}><div><span className="eyebrow">Buyer accounts</span><h2>Households & businesses</h2></div><span className="pill">{users.data?.filter((u) => u.role === 'buyer' || u.role === 'business').length || 0} accounts</span></div>{users.isLoading ? <div className="skeleton" style={{ height: 120 }} /> : users.data?.filter((u) => u.role === 'buyer' || u.role === 'business').length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Buyer</th><th>Account</th><th>Location</th><th>Joined</th></tr></thead><tbody>{users.data.filter((u) => u.role === 'buyer' || u.role === 'business').map((buyer) => <tr key={buyer.id} data-testid={`row-buyer-${buyer.id}`}><td><strong>{buyer.name}</strong><br /><span className="subtle">{buyer.email}</span></td><td>{buyer.organization || (buyer.role === 'business' ? 'Business buyer' : 'Household buyer')}</td><td>{buyer.location}</td><td>{niceDate(buyer.createdAt)}</td></tr>)}</tbody></table></div> : <Empty icon={<Users size={24} />} title="No buyers yet" text="Household and business accounts will appear here." />}</section>
     <section className="panel admin-section"><div className="section-head" style={{ marginTop: 0 }}><div><span className="eyebrow">Marketplace quality</span><h2>Product moderation</h2></div><span className="pill">{products.data?.length || 0} listings</span></div>{products.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : products.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Farmer</th><th>Category</th><th>Price</th><th>Availability</th><th>Actions</th></tr></thead><tbody>{products.data.map((p) => <tr key={p.id} data-testid={`row-moderation-product-${p.id}`}><td><strong>{p.name}</strong><br /><span className="subtle">{p.location}</span></td><td>{p.farmerName}{p.verifiedFarmer ? <BadgeCheck size={13} style={{ marginLeft: 5, verticalAlign: 'middle', color: '#47774e' }} /> : null}</td><td>{p.category}</td><td>{formatINR(p.price)} / {p.unit}</td><td>{p.quantity} {p.unit}</td><td><button className="button button-danger" onClick={() => removeProduct(p)} disabled={removeListing.isPending} data-testid={`button-remove-product-${p.id}`}>Remove</button></td></tr>)}</tbody></table></div> : <Empty icon={<Leaf size={24} />} title="No product listings" text="New marketplace listings will appear here for review." />}{removeListing.isError && <p className="form-error">{errorText(removeListing.error)}</p>}</section>
    <section className="panel admin-section"><div className="section-head" style={{ marginTop: 0 }}><div><span className="eyebrow">Fulfilment overview</span><h2>Marketplace orders</h2></div></div>{orders.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : orders.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Buyer</th><th>Placed</th><th>Status</th><th>Total</th><th>Update status</th></tr></thead><tbody>{orders.data.map((order) => <tr key={order.id} data-testid={`row-admin-order-${order.id}`}><td>#{order.id}</td><td>{order.buyerName}</td><td>{niceDate(order.createdAt)}</td><td><span className="status-tag">{order.status}</span></td><td>{formatINR(order.total)}</td><td><select className="select admin-status" value="" onChange={(e) => { if (e.target.value) setStatus(order, e.target.value as 'Confirmed'|'Processing'|'Shipped'|'Delivered'|'Cancelled'); }} disabled={updateStatus.isPending} data-testid={`select-admin-order-${order.id}`}><option value="">Choose status</option>{['Confirmed','Processing','Shipped','Delivered','Cancelled'].map((s) => <option value={s} key={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div> : <Empty icon={<PackageCheck size={24} />} title="No orders placed yet" text="Orders appear here as shoppers check out." />}{updateStatus.isError && <p className="form-error">{errorText(updateStatus.error)}</p>}</section>
  </div></div>;
}

function NotFound() {
  return <div className="page"><div className="container-wide"><Empty icon={<Search size={28} />} title="We couldn't find that path" text="Let's take you back to the harvest." action={<Link className="button button-primary" href="/">Back to marketplace</Link>} /></div></div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoot /></WouterRouter></QueryClientProvider>;
}

export default App;
