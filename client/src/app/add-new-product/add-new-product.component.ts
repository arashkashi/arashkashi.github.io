import { Component, OnInit } from '@angular/core';
import { FormBuilder, ValidationErrors, Validators, FormControl, ValidatorFn, AbstractControl } from '@angular/forms';
import { environment } from './../../environments/environment';
import { ApiRequestService } from '../api-request.service';
import { Router } from "@angular/router";
import { ActivatedRoute } from '@angular/router';




@Component({
  selector: 'app-add-new-product',
  templateUrl: './add-new-product.component.html',
  styleUrls: ['./add-new-product.component.css']
})

export class AddNewProductComponent implements OnInit {

  form;
  environment = environment;

  constructor(
    private formBuilder: FormBuilder,
    private apiService: ApiRequestService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.form = this.formBuilder.group({
      name: ['', Validators.required],
      properties: new FormControl('', [this.jsonValidator(), Validators.required])
    });
  }
  enteredName;
  enteredProperties;

  jsonValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      try {
        JSON.parse(control.value);
        return null;
      } catch (error) {
        // control.setErrors(error);
        return {'jsonValidator': {value: control.value}};
      }
    };
  }

  isFormStatusValid() {
    return this.form.status == 'INVALID'
  }

  product_id;

  onFetchingProductSuccess(product) {
    this.enteredName = product['name']
    this.enteredProperties = product['properties']
  }

  ngOnInit(): void {

    this.route.paramMap.subscribe(params => {
      this.product_id = params.get('productId');
        
        this.apiService.dispatchPostRequest("/api/products/" + this.product_id, {}).then(
          res => {
            this.onFetchingProductSuccess(res['product']);
        },
          msg => {})
    });
  }

  // To convert json to string
  // JSON.stringify(res)
  error;
  newUser;

  onSubmit(productData) {
    // Process checkout data here
    this.form.reset();

    if (this.product_id) {
      productData["id"] = this.product_id;
      this.apiService.dispatchPostRequest("/api/products/update", {'product':productData}).then(
        res => {
          this.router.navigate(['products'])
        },
        msg => {
          this.error = JSON.stringify(msg)
        }
      )
      return;

    } else {

      this.apiService.dispatchPostRequest("/api/products/addNewProduct", productData).then( 
        res => {
          if (!res['error']) {
            this.router.navigate(['products'])
          } else {
            this.error = JSON.stringify(res)
          }
      },
        msg => {
          this.error = JSON.stringify(msg)
      })
    }
  }
}