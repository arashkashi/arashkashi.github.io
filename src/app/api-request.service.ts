import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { LocalStorageService } from './local-storage.service';



@Injectable({
  providedIn: 'root'
})

export class ApiRequestService {

  constructor(private http: HttpClient,
              private localStorageService: LocalStorageService) { }

    dispatchPostRequest(path, data, requiresAuth = true) {

    if (requiresAuth) {

      const token = this.localStorageService.locallyStoredToken()

      const headers = new HttpHeaders({"bearer": token});

      return this.http.post(environment.api_endpoint + path, data, {headers}).toPromise();
    } else {
      return this.http.post(environment.api_endpoint + path, data).toPromise()
    }
  }

  dispatchPostFormDataRequest(path, formData) {

    const token = this.localStorageService.locallyStoredToken()

    let headers = new HttpHeaders({"bearer": token});
    headers.set('bearer', token)
    headers.set('Content-Type', 'formData')

    return this.http.post(environment.api_endpoint + path, formData, {headers}).toPromise();
  }
}
