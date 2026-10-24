// Only Firebase Authentication and Cloud Firestore are used. No Functions, Storage,
// App Hosting, Analytics, billing-enabled AI services, or third-party backend.
export class FirebaseStore {
  constructor(callbacks) {this.callbacks=callbacks;this.user=null;this.unwatch=null;this.ready=false;}
  async connect(config) {
    if(this.auth)throw new Error('Reload after changing Firebase projects.');
    if(!config?.apiKey||!config?.projectId||!config?.authDomain||!config?.appId) throw new Error('Firebase config needs apiKey, authDomain, projectId and appId.');
    const [app,auth,fire]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js')
    ]);
    this.a=auth;this.f=fire;this.app=app.initializeApp(config);this.auth=auth.getAuth(this.app);this.db=fire.getFirestore(this.app);this.ready=true;
    await auth.setPersistence(this.auth,auth.browserLocalPersistence);
    auth.onAuthStateChanged(this.auth,user=>{
      this.unwatch?.();this.unwatch=null;this.user=user;
      this.callbacks.onUser(user?{uid:user.uid,email:user.email,displayName:user.displayName}:null);
      if(!user)return;
      const uid=user.uid;this.ref=fire.doc(this.db,'users',uid,'sheets','main');
      this.unwatch=fire.onSnapshot(this.ref,{includeMetadataChanges:true},snapshot=>{
        if(this.user?.uid!==uid||snapshot.metadata.hasPendingWrites)return;
        // A cached empty document must not be mistaken for a new cloud account.
        if(snapshot.metadata.fromCache)return;
        this.callbacks.onDocument(snapshot.exists()?snapshot.data():null);
      },error=>this.callbacks.onError(error));
    });
  }
  google() {return this.a.signInWithPopup(this.auth,new this.a.GoogleAuthProvider());}
  email(email,password,create=false) {return create?this.a.createUserWithEmailAndPassword(this.auth,email,password):this.a.signInWithEmailAndPassword(this.auth,email,password);}
  resetPassword(email) {return this.a.sendPasswordResetEmail(this.auth,email);}
  signOut() {return this.a.signOut(this.auth);}
  async save(state,expectedRevision) {
    if(!this.user||!this.ref)throw new Error('Sign in before syncing.');
    const ref=this.ref,uid=this.user.uid;
    return this.f.runTransaction(this.db,async tx=>{
      if(this.user?.uid!==uid)throw new Error('Account changed; save cancelled.');
      const snapshot=await tx.get(ref),remoteRevision=snapshot.exists()?snapshot.data().revision:0;
      if(this.user?.uid!==uid)throw new Error('Account changed; save cancelled.');
      if(remoteRevision!==expectedRevision) {const err=new Error('This sheet changed on another device. Choose which version to keep.');err.code='rivet/conflict';throw err;}
      const revision=expectedRevision+1;
      tx.set(ref,{schemaVersion:1,payload:JSON.stringify(state),revision,updatedAt:this.f.serverTimestamp()});return revision;
    });
  }
}
export function friendlyFirebaseError(error) {
  const messages={'auth/invalid-credential':'Email or password is incorrect.','auth/email-already-in-use':'An account already uses that email. Sign in instead.','auth/weak-password':'Use a password of at least 6 characters.','auth/invalid-email':'Enter a valid email address.','auth/popup-blocked':'Your browser blocked the Google window. Try email sign-in.','auth/popup-closed-by-user':'Google sign-in was closed.','auth/unauthorized-domain':'Add this website’s domain to Firebase Authentication → Settings → Authorized domains.','auth/operation-not-allowed':'Enable this sign-in provider in Firebase Authentication.','permission-denied':'Firebase denied access. Deploy the included Firestore rules to your project.','unavailable':'Cloud sync is offline. Your changes are still on this device.','resource-exhausted':'The Firebase quota was reached. Changes are saved here; sync can resume when quota resets.','auth/network-request-failed':'The sign-in service could not be reached. Check your connection.'};
  return messages[error.code]||error.message||'Could not connect. Your local sheet is safe.';
}
