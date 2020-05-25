import { Injectable } from '@angular/core';
import * as CryptoJS from '../../node_modules/crypto-js';


@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  kToken = "kWeather";
  kUserId = "kUserID";

  encryptSecretKey = "thisisavery582havingeverythinginit"

  constructor(
    ) { }

  setTokenLocally(token) {
    const encrypted = this.encryptData({kWeather: token})
    localStorage.setItem(this.kToken, encrypted)
  }

  locallyStoredToken() {
    const encrypted = localStorage.getItem(this.kToken)
    return this.decryptData(encrypted)["kWeather"]
  }

  resetLocalStorage() {
    localStorage.setItem(this.kToken, null)
    localStorage.setItem(this.kUserId, null)
  }

  setLoggedInUserId(userId) {
    localStorage.setItem(this.kUserId, userId)
  }

  loggedInUserId() {
    return localStorage.get(this.kUserId)
  }

  encryptData(data) {

    try {
      return CryptoJS.AES.encrypt(JSON.stringify(data), this.encryptSecretKey).toString();
    } catch (e) {
      alert(e)
    }
  }

  decryptData(data) {

    try {
      const bytes = CryptoJS.AES.decrypt(data, this.encryptSecretKey);
      if (bytes.toString()) {
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
      }
      return data;
    } catch (e) {
      console.log(e);
    }
  }
}
