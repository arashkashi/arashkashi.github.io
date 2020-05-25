import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiRequestService } from '../api-request.service';



@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
  styleUrls: ['./user-profile.component.css']
})
export class UserProfileComponent implements OnInit {

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiRequestService
    ) { }


  user_id;
  name;
  email;

  error;

  onFetchingUserSuccess(user) {
    this.name = user['name']
    this.email = user['email']
  }

  ngOnInit(): void {

    this.route.paramMap.subscribe(params => {
      this.user_id = params.get('userId');
        
        this.apiService.dispatchPostRequest("/api/users/" + this.user_id, {}).then(
          res => {
            this.onFetchingUserSuccess(res['user']);
        },
          msg => {
            this.error = JSON.stringify(msg)
            alert(JSON.stringify(msg['error']))
          })
      })
  }
}
